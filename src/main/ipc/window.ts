import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';

/** 窗口 IPC 仅代理无框窗口控制；每次调用延迟取窗体，适配启动和销毁生命周期中的空窗口状态。 */
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
    // 最大化状态由 BrowserWindow 持有，切换结果通过主进程事件另行同步给渲染端。
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
