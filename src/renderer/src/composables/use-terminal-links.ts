/**
 * 终端链接处理：统一接管 xterm 内两类链接的点击行为。
 *
 * - OSC 8 富链接（带隐藏 URI 的转义序列）由 `Terminal` 的 `linkHandler` 选项处理；
 *   未注册时 xterm 会弹出 `window.confirm` 安全确认框，体验割裂。
 * - 裸文本 URL 由 WebLinksAddon 的回调处理。
 *
 * 两条路径都交给主进程 `shell.openExternal`（仅放行无凭据的 HTTP(S) 链接），
 * 由系统默认浏览器打开，失败时统一轻提示原因。
 */

import type { ILinkHandler } from '@xterm/xterm';
import { mofoxApi } from '@/services/mofox-api';
import { showToast } from '@/composables/use-toast';

/** 打开终端中的链接：交主进程校验并在系统浏览器打开，失败时轻提示原因。 */
export function openTerminalLink(uri: string): void {
  mofoxApi.openExternal(uri).catch((error: unknown) => {
    showToast(`无法打开链接: ${error instanceof Error ? error.message : String(error)}`);
  });
}

/**
 * 构建 `Terminal` 的 `linkHandler` 选项，接管 OSC 8 富链接点击。
 * 直接传给 `new Terminal({ linkHandler })`，避免 xterm 默认的确认弹窗。
 */
export function createTerminalLinkHandler(): ILinkHandler {
  return {
    activate: (event, uri) => {
      event.preventDefault();
      openTerminalLink(uri);
    },
  };
}
