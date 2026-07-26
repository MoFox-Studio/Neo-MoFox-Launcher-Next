import { app, BrowserWindow, ipcMain, shell } from 'electron';
import { join } from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import * as nodePty from 'node-pty';
import { IPC_EVENT_CHANNELS } from '../shared/ipc';
import { registerCoreIpc } from './ipc/core';
import { registerInstanceIpc } from './ipc/instances';
import { registerInstallIpc } from './ipc/install';
import { registerWindowIpc } from './ipc/window';
import { PlatformRegistry } from './platforms/registry';
import { EnvironmentService } from './services/environment-service';
import { InstallTaskService } from './services/install-task-service';
import { InstanceRepository } from './services/instance-repository';
import { InstanceRuntimeService } from './services/instance-runtime-service';
import { MirrorService } from './services/mirror-service';
import { PlatformMetadataService } from './services/platform-metadata-service';
import { SettingsService } from './services/settings-service';
import { createLogger, type Logger } from './utils/logger';
import { removePathSafe } from './utils/native-file-remover';
import { MofoxError } from '../shared/domain/error';

let mainWindow: BrowserWindow | null = null;

function emitMaximizeState(window: BrowserWindow): void {
  if (!window.isDestroyed()) {
    window.webContents.send(
      IPC_EVENT_CHANNELS['window-maximize-changed'],
      window.isMaximized(),
    );
  }
}

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 900,
    minHeight: 620,
    frame: false,
    show: false,
    backgroundColor: '#101418',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.once('ready-to-show', () => window.show());
  window.on('maximize', () => emitMaximizeState(window));
  window.on('unmaximize', () => emitMaximizeState(window));
  window.on('closed', () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-navigate', (event, url) => {
    if (url !== window.webContents.getURL()) event.preventDefault();
  });

  const developmentUrl = process.env.VITE_DEV_SERVER_URL;
  if (developmentUrl) void window.loadURL(developmentUrl);
  else void window.loadFile(join(__dirname, '../renderer/index.html'));

  return window;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  registerWindowIpc(ipcMain, () => mainWindow);

  app.on('second-instance', () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  });

  void app.whenReady().then(() => {
    const dataDirectory = app.getPath('userData');
    let logger: Logger | undefined;
    const report = (message: string, error: Error) => {
      if (logger) void logger.log('launcher', 'error', `${message}: ${error.message}`);
      else console.error(message, error);
    };
    const settings = new SettingsService(dataDirectory, report);
    const instances = new InstanceRepository(dataDirectory, report);
    const platforms = new PlatformRegistry();
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
    registerCoreIpc(ipcMain, {
      instances,
      environment: new EnvironmentService(),
      mirrors: new MirrorService(),
      platforms: new PlatformMetadataService(platforms),
      settings,
    });
    const send = (channel: string, payload: unknown) => {
      if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send(channel, payload);
    };
    const runtime = new InstanceRuntimeService(
      instances,
      platforms,
      {
        statusChanged: (instanceId, status) => send(
          IPC_EVENT_CHANNELS['instance-status-changed'],
          { instanceId, status },
        ),
        ptyData: (instanceId, source, data) => send(
          IPC_EVENT_CHANNELS['instance-pty-data'],
          { instanceId, source, data },
        ),
      },
      (command, args, options) => nodePty.spawn(command, args, {
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
      { repository: instances },
      { progress: (event) => send(IPC_EVENT_CHANNELS['install-progress'], event) },
    );
    registerInstallIpc(ipcMain, installTasks);
    mainWindow = createMainWindow();

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