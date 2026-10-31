import { dirname } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';
import type { InstallRequest } from '../../../shared/domain/install';
import { MofoxError } from '../../../shared/domain/error';
import type { InstallTaskContext } from './types';

/**
 * 配置任务：把用户在向导中填写的选项写入 MoFox 配置，并把平台与适配器配置
 * 委托给所选平台自身的 `configure` 实现。
 *
 * 依次处理 core.toml（主人/HTTP 路由）与 model.toml（API Key）；
 * 若选择了平台，则把端口、QQ 号与 MoFox config 目录交给平台完成
 * WS 端点与 OneBot 适配器配置的写入。
 *
 * @param ctx - 安装任务上下文；`platform` 由主服务按请求解析并注入。
 * @throws {MofoxError} 配置读写失败或缺少平台实例时抛出。
 */
export async function configureInstance(ctx: InstallTaskContext): Promise<void> {
  const mofoxConfigDir = join(ctx.stageDir, 'mofox', 'config');
  ctx.progress('正在写入 core.toml...', 0.2);
  await configureCoreToml(join(mofoxConfigDir, 'core.toml'), ctx.request);
  ctx.progress('正在写入 model.toml...', 0.4);
  await configureModelToml(join(mofoxConfigDir, 'model.toml'), ctx.request);
  if (ctx.request.platformId) {
    if (!ctx.platform) throw new MofoxError('NOT_FOUND', `未知平台: ${ctx.request.platformId}`);
    ctx.progress('正在配置平台与 OneBot 适配器...', 0.7);
    await ctx.platform.configure(ctx.request.instanceName, join(ctx.stageDir, 'platform'), {
      wsPort: ctx.request.wsPort,
      botQQ: ctx.request.botQQ,
      botNickname: ctx.request.botNickname,
      mofoxConfigDir,
    });
  }
  ctx.progress('配置完成', 1);
}

/** 在 `core.toml` 中写入主人列表，并在安装 WebUI 时启用 HTTP 路由、监听端口与访问密钥。 */
async function configureCoreToml(path: string, request: InstallRequest): Promise<void> {
  const data = await readTomlFile(path);
  const permissions = ensureSection(data, 'permissions');
  permissions.owner_list = [`qq:${request.ownerQQ}`];
  if (request.installWebui) {
    const httpRouter = ensureSection(data, 'http_router');
    httpRouter.enable_http_router = true;
    httpRouter.http_router_host = '127.0.0.1';
    httpRouter.http_router_port = request.webuiHttpPort;
    httpRouter.api_keys = [request.webuiApiKey];
  }
  await writeTomlFile(path, data);
}

/** 在 `model.toml` 中把第一个模型提供商的 API 密钥替换为用户输入的密钥。 */
async function configureModelToml(path: string, request: InstallRequest): Promise<void> {
  const data = await readTomlFile(path);
  if (Array.isArray(data.api_providers) && data.api_providers.length > 0) {
    data.api_providers[0].api_key = request.apiKey;
  } else {
    data.api_providers = [
      {
        name: 'SiliconFlow',
        base_url: 'https://api.siliconflow.cn/v1',
        api_key: request.apiKey,
        client_type: 'openai',
        max_retry: 2,
        timeout: 30,
        retry_interval: 10,
      },
    ];
  }
  await writeTomlFile(path, data);
}

/** 读取 TOML 文件；文件不存在时返回空对象以便写入默认配置。 */
async function readTomlFile(path: string): Promise<Record<string, unknown>> {
  try {
    // Windows 上主程序以文本模式落盘的配置是 CRLF：直接交给 smol-toml 解析会把
    // 多行字符串内的换行读成 `\r\n`，再序列化时变成 `\r\n` 转义序列，主程序重读
    // 会生成 `\r\r\n` 并因非法 `\r` 崩溃。读入前先统一成 LF 消除这个隐患。
    const text = await readFile(path, 'utf8');
    return parseToml(normalizeLf(text)) as Record<string, unknown>;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw error;
  }
}

/** 把 CRLF / 裸 CR 统一规范化为 LF。 */
function normalizeLf(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

/** 以 TOML 格式原子写入文件，自动创建父目录。 */
async function writeTomlFile(path: string, data: Record<string, unknown>): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, stringifyToml(data), 'utf8');
}

/** 读取或创建配置节，避免覆盖已有节内其他字段。 */
function ensureSection(data: Record<string, unknown>, key: string): Record<string, unknown> {
  const existing = data[key];
  if (typeof existing === 'object' && existing !== null && !Array.isArray(existing)) {
    return existing as Record<string, unknown>;
  }
  const section: Record<string, unknown> = {};
  data[key] = section;
  return section;
}

/** 判断值是否为普通对象（非数组、非 null）。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
