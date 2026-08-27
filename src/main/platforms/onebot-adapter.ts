import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { parse as parseToml, stringify as stringifyToml } from 'smol-toml';

/**
 * 写入 MoFox 的 OneBot 适配器配置。
 *
 * 所有平台适配器都通过 `onebot_adapter` 插件连接 MoFox，端口必须与平台自身
 * WS 客户端端点一致，因此该逻辑由各平台在 `configure` 阶段复用。
 *
 * @param mofoxConfigDir - MoFox 的 config 目录绝对路径。
 * @param wsPort - 平台 WS 客户端要连接的 OneBot 服务端口。
 * @param botQQ - 机器人账号 QQ 号，写入 `[bot].qq_id`。
 * @param botNickname - 机器人账号昵称；非空时写入 `[bot].qq_nickname`，为空则保留配置中已有值。
 */
export async function writeOnebotAdapterConfig(
  mofoxConfigDir: string,
  wsPort: number,
  botQQ: string,
  botNickname = '',
): Promise<void> {
  const path = join(mofoxConfigDir, 'plugins', 'onebot_adapter', 'config.toml');
  const data = await readTomlFile(path);
  const plugin = ensureSection(data, 'plugin');
  plugin.enabled = true;
  const server = ensureSection(data, 'onebot_server');
  server.mode = 'reverse';
  server.host = 'localhost';
  server.port = wsPort;
  const bot = ensureSection(data, 'bot');
  bot.qq_id = botQQ;
  const nickname = botNickname.trim();
  if (nickname) bot.qq_nickname = nickname;
  await writeTomlFile(path, data);
}

/** 读取 TOML 文件；文件不存在时返回空对象以便写入默认配置。 */
async function readTomlFile(path: string): Promise<Record<string, unknown>> {
  try {
    return parseToml(await readFile(path, 'utf8')) as Record<string, unknown>;
  } catch (error) {
    if (isRecord(error) && error.code === 'ENOENT') return {};
    throw error;
  }
}

/** 以 TOML 格式写入文件，自动创建父目录。 */
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
