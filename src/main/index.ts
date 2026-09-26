import {
  BrowserWindow,
  Menu,
  Notification,
  Tray,
  app,
  dialog,
  ipcMain,
  nativeImage,
  protocol,
  shell,
  systemPreferences,
} from 'electron';
import { setUnverifiedDownloadConfirmation } from './utils/git/download-consent';
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import { release } from 'node:os';
import * as nodePty from 'node-pty';
import { IPC_EVENT_CHANNELS } from '../shared/ipc';
import { registerCommonIpc } from './ipc/common';
import { registerCoreIpc } from './ipc/core';
import { registerInstallIpc } from './ipc/install';
import { registerMigrationIpc } from './ipc/migration';
import { registerManualImportIpc } from './ipc/manual-import';
import { registerOobeIpc } from './ipc/oobe';
import { registerInstanceIpc } from './ipc/instances';
import { registerInstanceManageIpc } from './ipc/instance-manage';
import { registerInstanceTerminalIpc } from './ipc/instance-terminal';
import { registerIntegrityIpc } from './ipc/integrity';
import { registerUpdateIpc } from './ipc/update';
import { registerWindowIpc } from './ipc/window';
import { registerWallpaperIpc } from './ipc/wallpaper';
import { registerVenvIpc } from './ipc/venv';
import { PlatformRegistry } from './platforms/registry';
import { OobeService } from './services/oobe-service';
import { InstallTaskService } from './services/install-task-service';
import { InstanceRepository } from './services/instance-repository';
import { InstanceRuntimeService } from './services/instance-runtime-service';
import { InstanceManageService } from './services/instance-manage-service';
import { InstanceTerminalService } from './services/instance-terminal-service';
import { InstanceIntegrityService } from './services/instance-integrity-service';
import { InstanceUpdateService } from './services/instance-update-service';
import {
  inspectImportPath,
  inspectPlatformPath,
  openExternalUrl,
  openFile,
  pickDirectory,
  pickFile,
} from './services/common-service';
import {
  LegacyMigrationService,
  resolveLegacyLauncherDataDir,
} from './services/legacy-migration-service';
import { MirrorService } from './utils/mirror';
import { ManualImportService } from './services/manual-import-service';
import { PlatformMetadataService } from './services/platform-metadata-service';
import { SettingsService } from './services/settings-service';
import { WallpaperService } from './services/wallpaper-service';
import { VenvService } from './services/venv-service';
import { createWallpaperProtocolHandler } from './wallpaper-protocol';
import type { VenvPackageResult } from '../shared/domain/venv';
import { EnvironmentService } from './utils/environment-service';
import { ProcessHelper } from './utils/process-helper';
import { createLogger, type Logger } from './utils/logger';
import { removePathSafe } from './utils/native-file-remover';
import { TrayController, type TrayPlatform } from './utils/tray';
import { BackgroundNotifier, type NotifyPlatform } from './utils/background-notifier';
import { MofoxError } from '../shared/domain/error';

/** 主进程组合根：管理单实例锁、窗口生命周期、服务依赖与主进程到渲染进程的事件同步。 */
let mainWindow: BrowserWindow | null = null;
/** 运行中的实例进程管理器；ready 后创建，退出时用于回收全部托管进程树。 */
let processHelper: ProcessHelper | null = null;
/** 无壁纸时的系统模糊材质开关；窗口创建与设置更新共用，重建窗口后状态不丢失。 */
let backdropEnabled = true;
/** 关闭窗口时是否转入托盘后台运行；随设置更新即时生效。 */
let closeToTrayEnabled = true;
/** 启动器不在前台时是否允许任务完成系统通知。 */
let trayNotificationsEnabled = true;
/** before-quit 置位后的窗口关闭不再转入托盘隐藏分支。 */
let quitting = false;
/** 托盘运行态管理器；ready 后创建，托盘菜单与后台通知共用。 */
let trayController: TrayController | null = null;

/** 将 Electron 返回的 RGB/RGBA 字符串收敛为渲染层使用的 #RRGGBB。 */
function normalizeSystemColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().replace(/^#/, '');
  if (!/^[0-9a-f]{6}(?:[0-9a-f]{2})?$/i.test(normalized)) return null;
  return `#${normalized.slice(0, 6).toUpperCase()}`;
}

/** 读取当前平台可用的系统强调色；Windows 使用系统高亮色作为稳定的初始值。 */
function getSystemAccentColor(): string | null {
  try {
    if (process.platform === 'darwin') {
      return normalizeSystemColor(systemPreferences.getAccentColor());
    }
    if (process.platform === 'win32') {
      return normalizeSystemColor(systemPreferences.getColor('highlight'));
    }
  } catch {
    // 某些 Linux 桌面环境或旧系统没有实现颜色查询，交给手动主题色回退。
  }
  return null;
}

// 该协议只服务由 WallpaperService 管理的副本，必须在 app ready 前声明为安全标准协议。
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'mofox-wallpaper',
    privileges: {
      standard: true,
      secure: true,
      supportFetchAPI: true,
      stream: true,
      corsEnabled: true,
    },
  },
]);

/**
 * 通知渲染进程当前窗口的最大化状态。
 *
 * 仅在窗口未销毁时发送，避免在关闭流程中触发已失效的 webContents 调用。
 *
 * @param window - 需要查询最大化状态的 BrowserWindow。
 */
function emitMaximizeState(window: BrowserWindow): void {
  // 最大化变化由窗口事件驱动，避免渲染端以本地推测替代 BrowserWindow 的真实状态。
  if (!window.isDestroyed()) {
    window.webContents.send(IPC_EVENT_CHANNELS['window-maximize-changed'], window.isMaximized());
  }
}

/** 解析开发模式与打包模式共用的应用图标路径。 */
function resolveAppIcon(): string | undefined {
  const candidates = [
    join(process.resourcesPath, 'icon.ico'),
    join(__dirname, '../../assets/images/icon.ico'),
  ];

  return candidates.find((candidate) => existsSync(candidate));
}

/** 解析托盘与系统通知共用的图标路径；Windows 使用 ico，其余平台优先 PNG。 */
function resolveTrayIcon(): string | undefined {
  const candidates =
    process.platform === 'win32'
      ? [join(process.resourcesPath, 'icon.ico'), join(__dirname, '../../assets/images/icon.ico')]
      : [
          join(process.resourcesPath, 'icon.png'),
          join(process.resourcesPath, 'icon.ico'),
          join(__dirname, '../../assets/images/icon.png'),
          join(__dirname, '../../assets/images/icon.ico'),
        ];

  return candidates.find((candidate) => existsSync(candidate));
}

/** Windows 11（Build 22000+）可由 DWM 为无边框 thick-frame 窗口绘制原生圆角。 */
function supportsNativeWindowsCorners(): boolean {
  if (process.platform !== 'win32') return false;
  const build = Number.parseInt(release().split('.')[2] ?? '', 10);
  return Number.isFinite(build) && build >= 22_000;
}

/**
 * 创建主窗口并绑定首帧显示、最大化同步、关闭回收与导航安全策略。
 *
 * 在开发模式下加载 Vite dev server，生产模式下加载打包后的本地 HTML；
 * 阻止新窗口弹出与跨页面导航以收敛渲染进程的能力边界。
 *
 * @returns 初始化完成的 BrowserWindow。
 */
function createMainWindow(): BrowserWindow {
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const nativeWindowsCorners = supportsNativeWindowsCorners();
  const appIcon = resolveAppIcon();

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    show: false,
    icon: appIcon,
    // Windows 的透明无边框窗口会被 Electron 强制移除 thick frame，DWM 因而无法绘制
    // Windows 11 原生圆角。Win11 保留原生 frame 能力；其他平台继续使用透明裁切回退。
    transparent: !nativeWindowsCorners,
    roundedCorners: true,
    ...(isWindows ? { thickFrame: nativeWindowsCorners } : {}),
    // 系统原生材质：无壁纸时由 shell 玻璃层透出桌面，提供微微模糊的桌面感；
    // 用户关闭"系统模糊效果"后停用原生材质，由渲染端铺纯色兜底表面。
    backgroundMaterial: isMac ? 'none' : isWindows && backdropEnabled ? 'mica' : 'none',
    visualEffectState: 'active',
    vibrancy: isMac && backdropEnabled ? 'under-window' : undefined,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // 原生窗口保持不透明时，页面自身仍需透明，才能露出 Windows 的 Mica 背板。
      transparent: true,
    },
  });

  // 窗口在首帧就绪后才显示，并在关闭时清空全局引用以支持 activate 重建。
  window.once('ready-to-show', () => window.show());
  window.on('maximize', () => emitMaximizeState(window));
  window.on('unmaximize', () => emitMaximizeState(window));
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  // IPC 是受控的渲染边界；阻止新窗口和跨页面导航扩大渲染进程权限面。
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });
  // 鼠标侧键（后退/前进）会触发 Chromium 历史导航，在 hash 路由下表现为页面
  // 意外回退；在事件派发进页面前直接吞掉，即可完全阻断导航且页面无感知。
  window.webContents.on('before-mouse-event', (event, mouse) => {
    // 官方类型只声明了 left/middle/right，运行时侧键实际取值为 back/forward。
    const button = mouse.button as string | undefined;
    if (button === 'back' || button === 'forward') event.preventDefault();
  });
  // F12 切换 DevTools，便于运行时调试渲染进程；Alt+←/→ 同样触发历史导航，一并禁用。
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (input.key === 'F12') {
      window.webContents.toggleDevTools();
      event.preventDefault();
      return;
    }
    if (input.alt && (input.key === 'ArrowLeft' || input.key === 'ArrowRight')) {
      event.preventDefault();
    }
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));

  return window;
}

/**
 * 将系统模糊材质开关即时应用到现存窗口。
 *
 * Windows 切换 Mica 背板，macOS 切换 under-window vibrancy；其余平台无原生材质。
 * 窗口尚未创建或已销毁时静默忽略，由窗口创建时读取的 `backdropEnabled` 兜底。
 *
 * @param window - 目标主窗口。
 * @param enabled - 是否启用系统模糊材质。
 */
function applyNativeBackdrop(window: BrowserWindow | null, enabled: boolean): void {
  if (!window || window.isDestroyed()) return;
  if (process.platform === 'win32') window.setBackgroundMaterial(enabled ? 'mica' : 'none');
  else if (process.platform === 'darwin') window.setVibrancy(enabled ? 'under-window' : null);
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // 窗口控制先注册，其余依赖存储和平台注册表的 IPC 在 Electron ready 后构造。
  registerWindowIpc(ipcMain, () => mainWindow);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    // 托盘后台运行时重新拉起主窗口；可见时等价于恢复并聚焦。
    trayController?.revealMainWindow();
  });

  void app.whenReady().then(async () => {
    setUnverifiedDownloadConfirmation(async (request, signal) => {
      if (!mainWindow || mainWindow.isDestroyed() || signal?.aborted) return false;
      const result = await dialog.showMessageBox(mainWindow, {
        type: 'warning',
        title: '无法验证下载包',
        message: '此下载无法进行 SHA-256 校验，是否仍要继续？',
        detail: `${request.reason}\n\n仓库：${request.repository}\n版本：${request.version}\n文件：${request.assetName}\n\n无法确认下载内容是否被篡改。仅在信任该来源且理解风险时继续；本次选择不会用于其他文件或后续安装。`,
        buttons: ['取消下载', '我理解风险，继续本次下载'],
        defaultId: 0,
        cancelId: 0,
        noLink: true,
        ...(signal ? { signal } : {}),
      });
      return result.response === 1;
    });
    const dataDirectory = app.getPath('userData');
    let logger: Logger | undefined;
    /**
     * 在日志器初始化前后报告启动期错误；未就绪时降级输出到控制台。
     *
     * @param message - 错误上下文说明。
     * @param error - 需要记录的错误对象。
     */
    const report = (message: string, error: Error) => {
      if (logger) void logger.log('launcher', 'error', `${message}: ${error.message}`);
      else console.error(message, error);
    };
    const settings = new SettingsService(dataDirectory, report);
    /** Electron 托盘宿主实现；图标缺失时由 Electron 使用默认图标。 */
    const trayPlatform: TrayPlatform = {
      createTray: ({ tooltip, icon, items, onIconActivate }) => {
        const tray = new Tray(icon ?? nativeImage.createEmpty());
        tray.setToolTip(tooltip);
        tray.setContextMenu(
          Menu.buildFromTemplate(
            items.map((item) => ({ label: item.label, click: () => item.activate() })),
          ),
        );
        if (onIconActivate) tray.on('click', () => onIconActivate());
        return { destroy: () => tray.destroy() };
      },
    };
    trayController = new TrayController(trayPlatform, {
      getWindow: () => mainWindow,
      getIcon: resolveTrayIcon,
      tooltip: 'Neo-MoFox 启动器',
      onQuitRequest: () => {
        quitting = true;
        app.quit();
      },
    });
    /** Electron 系统通知宿主实现。 */
    const notifyPlatform: NotifyPlatform = {
      notify: (title, body) => {
        if (!Notification.isSupported()) return;
        const icon = resolveTrayIcon();
        const notification = new Notification({ title, body, ...(icon ? { icon } : {}) });
        // 点击通知即回到主页面，缩短后台任务的查看路径。
        notification.on('click', () => trayController?.revealMainWindow());
        notification.show();
      },
    };
    /** 后台任务通知器：窗口失焦或不可见时弹出，前台聚焦时静默。 */
    const backgroundNotifier = new BackgroundNotifier(notifyPlatform, {
      getWindow: () => mainWindow,
      enabled: () => trayNotificationsEnabled,
      enteredBackgroundNotice: {
        title: 'Neo-MoFox 启动器',
        body: '启动器仍在后台运行，可随时从托盘菜单恢复主页面或退出。',
      },
    });
    const wallpapers = new WallpaperService(dataDirectory, settings);
    const instances = new InstanceRepository(dataDirectory, report);
    const platforms = new PlatformRegistry();
    const mirrors = new MirrorService();
    // 通用服务（对话框 + 目录校验 + 打开外部链接）依赖平台注册表，因此在 ready 后随其余 IPC 一并注册。
    registerCommonIpc(ipcMain, {
      pickFile: (options) => pickFile(() => mainWindow, options),
      pickDirectory: (options) => pickDirectory(() => mainWindow, options),
      inspectImportPath: (value) => inspectImportPath(value),
      inspectPlatformPath: (platformId, value) => inspectPlatformPath(platforms, platformId, value),
      openExternal: (url) => openExternalUrl(shell.openExternal, url),
    });
    logger = createLogger({
      directory: join(dataDirectory, 'logs'),
      getSettings: async () => {
        const value = await settings.get();
        return {
          maxFileSizeMb: value.maxLogFileSizeMb,
          maxArchiveDays: value.maxLogArchiveDays,
          compressLogArchive: value.compressLogArchive,
        };
      },
    });
    const environment = new EnvironmentService();
    registerCoreIpc(ipcMain, {
      instances,
      environment,
      platforms: new PlatformMetadataService(platforms),
      // 设置通道包装一层以同步系统模糊材质开关；壁纸/OOBE 写入的字段不涉及该开关。
      settings: {
        get: () => settings.get(),
        update: async (patch) => {
          const next = await settings.update(patch);
          backdropEnabled = next.systemBackdrop;
          closeToTrayEnabled = next.closeToTray;
          trayNotificationsEnabled = next.trayNotifications;
          applyNativeBackdrop(mainWindow, next.systemBackdrop);
          return next;
        },
      },
      appearance: { getSystemAccentColor },
      dataFiles: {
        open: (kind) =>
          openFile(
            shell.openPath,
            kind === 'settings' ? settings.filePath : instances.filePath,
            dataDirectory,
          ),
      },
    });
    registerWallpaperIpc(ipcMain, {
      selectAndStage: async () => {
        const selected = await pickFile(() => mainWindow, {
          title: '选择壁纸',
          filters: [
            { name: '图片壁纸', extensions: ['jpg', 'jpeg', 'png', 'webp'] },
            { name: '视频壁纸', extensions: ['mp4', 'webm'] },
          ],
        });
        return selected ? wallpapers.stage(selected[0]) : null;
      },
      commit: (id) => wallpapers.commit(id),
      discard: (id) => wallpapers.discard(id),
      remove: () => wallpapers.remove(),
    });
    protocol.handle('mofox-wallpaper', createWallpaperProtocolHandler(wallpapers));
    /**
     * 向当前有效的主窗口转发服务事件；窗口重建期间丢弃通知。
     *
     * @param channel - IPC 事件通道。
     * @param payload - 发送给渲染进程的事件载荷。
     */
    const send = (channel: string, payload: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    };
    if (process.platform === 'win32' || process.platform === 'linux') {
      systemPreferences.on('accent-color-changed', (_event, color) => {
        send(IPC_EVENT_CHANNELS['system-accent-color-changed'], normalizeSystemColor(color));
      });
    }
    if (process.platform === 'win32') {
      systemPreferences.on('color-changed', () => {
        send(IPC_EVENT_CHANNELS['system-accent-color-changed'], getSystemAccentColor());
      });
    }
    processHelper = new ProcessHelper((command, args, options) =>
      nodePty.spawn(command, args, {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: options.env,
      }),
    );

    const runtime = new InstanceRuntimeService(
      instances,
      platforms,
      {
        statusChanged: (instanceId, status) =>
          send(IPC_EVENT_CHANNELS['instance-status-changed'], { instanceId, status }),
        ptyData: (instanceId, source, data) =>
          send(IPC_EVENT_CHANNELS['instance-pty-data'], { instanceId, source, data }),
      },
      processHelper,
      async (fileName, content) => {
        const exportsDir = join(dataDirectory, 'exports');
        await mkdir(exportsDir, { recursive: true });
        const filePath = join(exportsDir, fileName);
        await writeFile(filePath, content, 'utf8');
        return filePath;
      },
    );
    const manage = new InstanceManageService(
      runtime,
      instances,
      platforms,
      removePathSafe,
      async (path) => {
        const error = await shell.openPath(path);
        if (error) throw new MofoxError('IO_ERROR', error);
      },
    );
    registerInstanceIpc(ipcMain, {
      start: (instanceId) => runtime.start(instanceId),
      stop: (instanceId) => runtime.stop(instanceId),
      restart: (instanceId) => runtime.restart(instanceId),
      startSource: (instanceId, source) => runtime.startSource(instanceId, source),
      stopSource: (instanceId, source) => runtime.stopSource(instanceId, source),
      restartSource: (instanceId, source) => runtime.restartSource(instanceId, source),
      getLogBuffer: (instanceId, source) => runtime.getLogBuffer(instanceId, source),
      clearLogBuffer: (instanceId, source) => runtime.clearLogBuffer(instanceId, source),
      writePty: (instanceId, source, data) => runtime.writePty(instanceId, source, data),
      resizePty: (instanceId, source, cols, rows) =>
        runtime.resizePty(instanceId, source, cols, rows),
      getStats: (instanceId) => runtime.getStats(instanceId),
      exportLogs: (instanceId, source) => runtime.exportLogs(instanceId, source),
    });
    registerInstanceManageIpc(ipcMain, {
      remove: (instanceId, mode) => manage.remove(instanceId, mode),
      openFolder: (instanceId, kind) => manage.openFolder(instanceId, kind),
      update: (instanceId, patch) => manage.update(instanceId, patch),
    });
    // 实例终端：与实例进程共享同一 ProcessHelper，但键空间独立（terminal:<id>）。
    const terminals = new InstanceTerminalService(instances, processHelper, {
      data: (instanceId, data) =>
        send(IPC_EVENT_CHANNELS['instance-terminal-data'], { instanceId, data }),
      exited: (instanceId, exitCode) =>
        send(IPC_EVENT_CHANNELS['instance-terminal-exited'], { instanceId, exitCode }),
    });
    registerInstanceTerminalIpc(ipcMain, {
      listShells: () => terminals.listShells(),
      open: (instanceId, kind, options) => terminals.open(instanceId, kind, options),
      write: (instanceId, data) => terminals.write(instanceId, data),
      resize: (instanceId, cols, rows) => terminals.resize(instanceId, cols, rows),
      close: (instanceId) => terminals.close(instanceId),
    });
    registerIntegrityIpc(ipcMain, {
      check: () => new InstanceIntegrityService(instances, platforms).check(),
    });
    const updates = new InstanceUpdateService(
      instances,
      platforms,
      mirrors,
      runtime,
      {
        progress: (event) => send(IPC_EVENT_CHANNELS['update-progress'], event),
      },
      (level, message) => {
        void logger.log('update', level, message);
      },
    );
    /**
     * 解析实例显示名；实例已被移除或 ID 无效时回退为「实例」。
     *
     * @param instanceId - 实例 ID。
     */
    const resolveInstanceName = async (instanceId: string): Promise<string> =>
      (await instances.list()).find((instance) => instance.id === instanceId)?.name ?? '实例';

    /**
     * 观察可能后台落定的实例任务，并按结果弹出系统通知。
     *
     * 通知仅在窗口失焦或不可见且用户允许时真正发出；返回原 Promise，
     * 不改变 IPC 结果语义。
     *
     * @param instanceId - 任务所属实例 ID。
     * @param task - 待观察的任务。
     * @param action - 动作名称，如「主程序更新」。
     * @returns 原样返回的任务 Promise。
     */
    const watchInstanceTask = <T>(
      instanceId: string,
      task: Promise<T>,
      action: string,
    ): Promise<T> => {
      void task.then(
        async () =>
          backgroundNotifier.notifyTaskFinished(
            `${action}完成`,
            `实例「${await resolveInstanceName(instanceId)}」${action}已完成`,
          ),
        async () =>
          backgroundNotifier.notifyTaskFinished(
            `${action}失败`,
            `实例「${await resolveInstanceName(instanceId)}」${action}失败，请打开启动器查看详情`,
          ),
      );
      return task;
    };

    /**
     * 按虚拟环境操作的结果对象弹出后台通知；结果原样返回。
     *
     * @param instanceId - 操作所属实例 ID。
     * @param task - 待观察的操作。
     * @param action - 动作名称，如「依赖安装」。
     * @returns 原样返回的操作结果。
     */
    const notifyVenvResult = async (
      instanceId: string,
      task: Promise<VenvPackageResult>,
      action: string,
    ): Promise<VenvPackageResult> => {
      const result = await task;
      const instanceName = await resolveInstanceName(instanceId);
      backgroundNotifier.notifyTaskFinished(
        result.ok ? `${action}完成` : `${action}失败`,
        result.ok
          ? `实例「${instanceName}」${action}已完成`
          : (result.message ?? `实例「${instanceName}」${action}失败，请打开启动器查看详情`),
      );
      return result;
    };
    registerUpdateIpc(ipcMain, {
      getMofoxInfo: (instanceId) => updates.getMofoxInfo(instanceId),
      switchBranch: (instanceId, branch) =>
        watchInstanceTask(instanceId, updates.switchBranch(instanceId, branch), '分支切换'),
      checkoutCommit: (instanceId, commitHash) =>
        watchInstanceTask(instanceId, updates.checkoutCommit(instanceId, commitHash), '版本回退'),
      updateMofox: (instanceId) =>
        watchInstanceTask(instanceId, updates.updateMofox(instanceId), '主程序更新'),
      getPlatformInfo: (instanceId) => updates.getPlatformInfo(instanceId),
      updatePlatform: (instanceId, version) =>
        watchInstanceTask(instanceId, updates.updatePlatform(instanceId, version), '平台更新'),
    });
    const installTasks = new InstallTaskService(
      platforms,
      {
        repository: instances,
        mirrors,
      },
      {
        progress: (event) => {
          send(IPC_EVENT_CHANNELS['install-progress'], event);
          // 安装任务可能后台落定；结果通过系统通知告知（前台聚焦时静默）。
          if (event.status === 'done') {
            backgroundNotifier.notifyTaskFinished(
              '实例安装完成',
              `「${event.instanceName}」安装完成，可以启动了`,
            );
          } else if (event.status === 'failed') {
            backgroundNotifier.notifyTaskFinished(
              '实例安装失败',
              `「${event.instanceName}」安装失败，请打开启动器查看详情`,
            );
          }
        },
      },
    );
    registerInstallIpc(ipcMain, installTasks);
    registerManualImportIpc(ipcMain, new ManualImportService(instances, platforms));
    const venvs = new VenvService(
      { list: () => instances.list(), mirrors },
      undefined,
      {
        progress: (event) => send(IPC_EVENT_CHANNELS['venv-progress'], event),
      },
      runtime,
    );
    registerVenvIpc(ipcMain, {
      inspect: (value) => venvs.inspect(value),
      getVenvInfo: (instanceId) => venvs.getVenvInfo(instanceId),
      install: (instanceId, name, version) =>
        notifyVenvResult(instanceId, venvs.install(instanceId, name, version), '依赖安装'),
      uninstall: (instanceId, name) =>
        notifyVenvResult(instanceId, venvs.uninstall(instanceId, name), '依赖卸载'),
      update: (instanceId, name) =>
        notifyVenvResult(instanceId, venvs.upgrade(instanceId, name), '依赖更新'),
      queryVersions: (instanceId, name) => venvs.queryVersions(instanceId, name),
      getPackageInfo: (instanceId, name) => venvs.getVenvPackageInfo(instanceId, name),
    });
    // 旧启动器迁移：默认指向与当前 userData 同级的 Neo-MoFox-Launcher 目录。
    const legacyDataDir = resolveLegacyLauncherDataDir({
      appDataDir: app.getPath('appData'),
      override: process.env.NEO_MOFOX_LEGACY_DATA,
    });
    const legacyMigration = new LegacyMigrationService(legacyDataDir, instances, report);
    registerMigrationIpc(ipcMain, legacyMigration);
    const oobeService = new OobeService(
      { settings, legacy: legacyMigration, mirrors, environment },
      {
        progress: (event) => send(IPC_EVENT_CHANNELS['oobe-progress'], event),
      },
    );
    registerOobeIpc(ipcMain, oobeService);
    // 窗口显示前读取一次设置快照，同步材质与托盘相关开关，避免启动瞬间状态不一致。
    const initialSettings = await settings.get();
    backdropEnabled = initialSettings.systemBackdrop;
    closeToTrayEnabled = initialSettings.closeToTray;
    trayNotificationsEnabled = initialSettings.trayNotifications;
    mainWindow = createMainWindow();

    // 正常关闭先等待安装任务取消并清理现场；等待期间重复关闭也不能绕过收尾。
    let installCloseDispatched = false;
    let installCloseReady = false;
    mainWindow.on('close', (event) => {
      if (installCloseReady) return;
      // 托盘模式：用户主动关闭仅隐藏窗口，安装与更新等后台任务继续运行。
      if (!quitting && closeToTrayEnabled && trayController?.minimizeToTray()) {
        event.preventDefault();
        backgroundNotifier.notifyEnteredBackground();
        return;
      }
      event.preventDefault();
      if (installCloseDispatched) return;
      installCloseDispatched = true;
      void installTasks
        .cancelAll()
        .then(() => {
          installCloseReady = true;
          mainWindow?.close();
        })
        .catch((error: unknown) => {
          installCloseDispatched = false;
          report(
            '取消安装失败，未关闭窗口',
            error instanceof Error ? error : new Error(String(error)),
          );
        });
    });

    app.on('activate', () => {
      if (!mainWindow) mainWindow = createMainWindow();
      else trayController?.revealMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });

  // 应用退出前强制回收所有托管进程树，避免关闭启动器后遗留平台子进程。
  app.on('before-quit', () => {
    quitting = true;
    trayController?.destroy();
    processHelper?.killAll();
  });
}
