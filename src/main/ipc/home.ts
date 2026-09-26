import { serializeIpcError } from '../../shared/domain/error';
import { IPC_INVOKE_CHANNELS } from '../../shared/ipc';
import type {
  HomeDocContent,
  HomeDocEntry,
  Quote,
  QuoteProviderId,
} from '../../shared/domain/home';

/** 主页部件 IPC 边界：文档读取与在线名言获取，业务逻辑全部保留在服务层。 */
interface HomeActions {
  /** 弹出系统对话框选择本地文档，返回可持久化的条目元数据。 */
  pickDocs(): Promise<HomeDocEntry[]>;
  /** 读取本地文档正文；路径在服务层完成扩展名与大小校验。 */
  readDoc(path: string): Promise<HomeDocContent>;
  /** 拉取远程文档正文；链接在服务层完成 HTTPS 与内网地址校验。 */
  fetchRemoteDoc(url: string): Promise<HomeDocContent>;
  /** 从在线一言服务获取一条名言。 */
  fetchQuote(provider: QuoteProviderId, categories?: readonly string[]): Promise<Quote>;
}

interface IpcMainRegistrar {
  handle(channel: string, listener: (event: unknown, ...args: unknown[]) => unknown): unknown;
}

/**
 * 注册主页部件相关 IPC 通道，并在跨进程边界校验参数形状。
 *
 * @param ipcMain - Electron ipcMain 句柄或其测试替身。
 * @param actions - 暴露给渲染端的主页动作集合。
 */
export function registerHomeIpc(ipcMain: IpcMainRegistrar, actions: HomeActions): void {
  ipcMain.handle(IPC_INVOKE_CHANNELS.pickHomeDocs, async () => {
    try {
      return await actions.pickDocs();
    } catch (error) {
      throw serializeIpcError(error);
    }
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.readHomeDoc, async (_event, ...args) => {
    try {
      requireArgs(args, 1, 'home-docs:read');
      return await actions.readDoc(requireString(args[0], '文档路径'));
    } catch (error) {
      throw serializeIpcError(error);
    }
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.fetchHomeRemoteDoc, async (_event, ...args) => {
    try {
      requireArgs(args, 1, 'home-docs:fetch-remote');
      return await actions.fetchRemoteDoc(requireString(args[0], '远程文档链接'));
    } catch (error) {
      throw serializeIpcError(error);
    }
  });

  ipcMain.handle(IPC_INVOKE_CHANNELS.fetchQuote, async (_event, ...args) => {
    try {
      if (args.length < 1 || args.length > 2) {
        throw new Error('home-quotes:fetch takes one provider and an optional categories list');
      }
      return await actions.fetchQuote(requireQuoteProvider(args[0]), requireCategories(args[1]));
    } catch (error) {
      throw serializeIpcError(error);
    }
  });
}

/** 校验参数个数；多余或缺失的参数一律视为非法调用。 */
function requireArgs(args: unknown[], count: number, channel: string): void {
  if (args.length !== count) throw new Error(`${channel} takes exactly ${count} argument(s)`);
}

/** 校验字符串参数。 */
function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string') throw new Error(`${label} must be a string`);
  return value;
}

/** 校验名言来源参数；随机选择由渲染层决定，主进程只接受具体来源。 */
function requireQuoteProvider(value: unknown): QuoteProviderId {
  if (value !== 'hitokoto' && value !== 'jinrishici') {
    throw new Error('quote provider must be hitokoto or jinrishici');
  }
  return value;
}

/** 校验分类列表参数；缺省视为未过滤。 */
function requireCategories(value: unknown): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || !value.every((entry) => typeof entry === 'string')) {
    throw new Error('quote categories must be an array of strings');
  }
  return value as string[];
}
