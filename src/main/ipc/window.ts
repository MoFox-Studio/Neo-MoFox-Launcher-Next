import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

export interface WindowController {
  minimize(): void;
  maximize(): void;
  unmaximize(): void;
  close(): void;
  isMaximized(): boolean;
}

export interface IpcMainRegistrar {
  handle(channel: string, listener: () => unknown): void;
}

export function registerWindowIpc(
  ipcMain: IpcMainRegistrar,
  getWindow: () => WindowController | null,
): void {
  ipcMain.handle(IPC_INVOKE_CHANNELS.windowMinimize, () => {
    getWindow()?.minimize();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.windowToggleMaximize, () => {
    const window = getWindow();
    if (!window) return;
    if (window.isMaximized()) window.unmaximize();
    else window.maximize();
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.windowClose, () => {
    getWindow()?.close();
  });

  ipcMain.handle(
    IPC_INVOKE_CHANNELS.windowIsMaximized,
    () => getWindow()?.isMaximized() ?? false,
  );
}