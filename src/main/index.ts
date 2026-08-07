import { app, BrowserWindow, ipcMain, protocol, shell } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import * as nodePty from 'node-pty';
import { IPC_EVENT_CHANNELS } from '../shared/ipc';
import { registerCommonIpc } from './ipc/common';
import { registerCoreIpc } from './ipc/core';
import { registerInstallIpc } from './ipc/install';
import { registerMigrationIpc } from './ipc/migration';
import { registerOobeIpc } from './ipc/oobe';
import { registerInstanceIpc } from './ipc/instances';
import { registerWindowIpc } from './ipc/window';
import { registerWallpaperIpc } from './ipc/wallpaper';
import { PlatformRegistry } from './platforms/registry';
import { OobeService } from './services/oobe-service';
import { InstallTaskService } from './services/install-task-service';
import { InstanceRepository } from './services/instance-repository';
import { InstanceRuntimeService } from './services/instance-runtime-service';
import { pickDirectory, pickFile } from './services/filepicker-service';
import {
  LegacyMigrationService,
  resolveLegacyLauncherDataDir,
  resolveNextLauncherDataDir,
} from './services/legacy-migration-service';
import { MirrorService } from './services/mirror-service';
import { PlatformMetadataService } from './services/platform-metadata-service';
import { SettingsService } from './services/settings-service';
import { WallpaperService } from './services/wallpaper-service';
import { createWallpaperProtocolHandler } from './wallpaper-protocol';
import { EnvironmentService } from './utils/environment-service';
import { createLogger, type Logger } from './utils/logger';
import { removePathSafe } from './utils/native-file-remover';
import { MofoxError } from '../shared/domain/error';

/** 主进程组合根：管理单实例锁、窗口生命周期、服务依赖与主进程到渲染进程的事件同步。 */
let mainWindow: BrowserWindow | null = null;

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

/**
 * 创建主窗口并绑定首帧显示、最大化同步、关闭回收与导航安全策略。
 *
 * 在开发模式下加载 Vite dev server，生产模式下加载打包后的本地 HTML；
 * 阻止新窗口弹出与跨页面导航以收敛渲染进程的能力边界。
 *
 * @returns 初始化完成的 BrowserWindow。
 */
function createMainWindow(): BrowserWindow {
  const isWindows = process.platform === 'win32';

  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    icon: app.isPackaged
      ? join(process.resourcesPath, 'icon.ico')
      : join(__dirname, '../../assets/images/icon.ico'),
    frame: false,
    show: false,
    // Acrylic 必须使用普通 DWM 窗口；layered transparent 窗口不会获得 Windows 11 原生圆角。
    transparent: !isWindows,
    backgroundColor: '#00000000',
    backgroundMaterial: isWindows ? 'acrylic' : 'none',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
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
  // F12 切换 DevTools，便于运行时调试渲染进程。
  window.webContents.on('before-input-event', (event, input) => {
    if (input.key === 'F12' && input.type === 'keyDown') {
      window.webContents.toggleDevTools();
      event.preventDefault();
    }
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));

  return window;
}

// 新旧启动器必须使用不同的 userData；迁移服务只读旧目录，避免新版 schema 覆盖旧 instances.json。
app.setPath('userData', resolveNextLauncherDataDir(app.getPath('appData')));

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  // 窗口控制先注册，其余依赖存储和平台注册表的 IPC 在 Electron ready 后构造。
  registerWindowIpc(ipcMain, () => mainWindow);
  // 通用对话框（选择文件/文件夹）仅依赖主窗口句柄，提前注册以供 OOBE 与设置页共同复用。
  registerCommonIpc(ipcMain, {
    pickFile: (options) => pickFile(() => mainWindow, options),
    pickDirectory: (options) => pickDirectory(() => mainWindow, options),
  });

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(async () => {
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
    const wallpapers = new WallpaperService(dataDirectory, settings);
    const instances = new InstanceRepository(dataDirectory, report);
    const platforms = new PlatformRegistry();
    const mirrors = new MirrorService();
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
      settings,
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
    const runtime = new InstanceRuntimeService(
      instances,
      platforms,
      {
        statusChanged: (instanceId, status) =>
          send(IPC_EVENT_CHANNELS['instance-status-changed'], { instanceId, status }),
        ptyData: (instanceId, source, data) =>
          send(IPC_EVENT_CHANNELS['instance-pty-data'], { instanceId, source, data }),
      },
      (command, args, options) =>
        nodePty.spawn(command, args, {
          name: 'xterm-256color',
          cols: options.cols,
          rows: options.rows,
          cwd: options.cwd,
          env: options.env,
        }),
      removePathSafe,
      async (path) => {
        const error = await shell.openPath(path);
        if (error) throw new MofoxError('IO_ERROR', error);
      },
      async (fileName, content) => {
        const exportsDir = join(dataDirectory, 'exports');
        await mkdir(exportsDir, { recursive: true });
        const filePath = join(exportsDir, fileName);
        await writeFile(filePath, content, 'utf8');
        return filePath;
      },
    );
    registerInstanceIpc(ipcMain, runtime);
    const installTasks = new InstallTaskService(
      platforms,
      { repository: instances, mirrors },
      { progress: (event) => send(IPC_EVENT_CHANNELS['install-progress'], event) },
    );
    registerInstallIpc(ipcMain, installTasks);
    // 旧启动器迁移：默认指向与当前 userData 同级的 Neo-MoFox-Launcher 目录。
    const legacyDataDir = resolveLegacyLauncherDataDir({
      appDataDir: app.getPath('appData'),
      override: process.env.NEO_MOFOX_LEGACY_DATA,
    });
    const legacyMigration = new LegacyMigrationService(legacyDataDir, instances, report);
    // 在窗口开放启动操作前纠正旧版迁移曾推测错误的平台目录。
    try {
      await legacyMigration.repairExistingInstances();
    } catch (error) {
      report(
        'Unable to repair legacy instance platform paths',
        error instanceof Error ? error : new Error(String(error)),
      );
    }
    registerMigrationIpc(ipcMain, legacyMigration);
    const oobeService = new OobeService(
      { settings, legacy: legacyMigration, mirrors, environment },
      {
        progress: (event) => send(IPC_EVENT_CHANNELS['oobe-progress'], event),
      },
    );
    registerOobeIpc(ipcMain, oobeService);
    mainWindow = createMainWindow();

    // 活跃安装任务必须先收到取消与清理机会，防止关闭窗口留下临时安装状态。
    mainWindow.on('close', (event) => {
      if (!installTasks.hasActiveTasks()) return;
      event.preventDefault();
      void installTasks.cancelAll().then(() => mainWindow?.close());
    });

    app.on('activate', () => {
      if (!mainWindow) mainWindow = createMainWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
