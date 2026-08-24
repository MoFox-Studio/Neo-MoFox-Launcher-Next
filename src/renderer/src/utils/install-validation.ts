/**
 * 安装向导各输入字段的校验函数。
 * 每个函数返回空字符串表示合法，否则返回面向用户的错误提示。
 */

/** 实例名称：1-32 字符，仅允许字母、数字、中文、空格与常见安全符号。 */
export function validateInstanceName(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '实例名称不能为空';
  if (trimmed.length > 32) return '实例名称不能超过 32 个字符';
  if (!/^[\w\u4e00-\u9fa5 ._-]+$/u.test(trimmed)) return '实例名称包含非法字符';
  return '';
}

/** QQ 号：5-12 位纯数字。 */
export function validateQQNumber(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'QQ 号不能为空';
  if (!/^\d{5,12}$/.test(trimmed)) return 'QQ 号应为 5-12 位纯数字';
  return '';
}

/** API 密钥：非空即可，建议以 `sk-` 开头（不做强制）。 */
export function validateApiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'API Key 不能为空';
  if (trimmed.length < 8) return 'API Key 长度不足';
  return '';
}

/** WebSocket 端口：1024-65535 的整数。 */
export function validateWsPort(value: number): string {
  if (!Number.isInteger(value)) return '端口必须是整数';
  if (value < 1024 || value > 65535) return '端口必须在 1024-65535 之间';
  return '';
}

/** WebUI 密钥：至少 8 位。 */
export function validateWebuiKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return 'WebUI 密钥不能为空';
  if (trimmed.length < 8) return 'WebUI 密钥至少需要 8 位';
  return '';
}

/** 目标目录：非空即可，具体绝对路径校验交由主进程完成。 */
export function validateTargetDir(value: string): string {
  if (!value.trim()) return '安装目录不能为空';
  return '';
}

/** 评估 WebUI 密钥强度，供密码强度指示器展示。 */
export function evaluateKeyStrength(value: string): {
  score: number;
  level: 'none' | 'weak' | 'medium' | 'strong';
  text: string;
} {
  if (!value) return { score: 0, level: 'none', text: '未输入' };
  let score = 0;
  if (value.length >= 8) score += 10;
  if (value.length >= 12) score += 10;
  if (value.length >= 16) score += 10;
  if (value.length >= 20) score += 10;
  if (/[a-z]/.test(value)) score += 15;
  if (/[A-Z]/.test(value)) score += 15;
  if (/[0-9]/.test(value)) score += 15;
  if (/[^a-zA-Z0-9]/.test(value)) score += 15;
  if (score < 40) return { score, level: 'weak', text: '弱 - 不推荐使用' };
  if (score < 70) return { score, level: 'medium', text: '中等 - 建议使用随机生成' };
  return { score, level: 'strong', text: '强' };
}

/** 生成安全的随机密钥（单密钥）。 */
export function generateSecureKey(length = 32): string {
  const charset = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const array = new Uint8Array(length);
  crypto.getRandomValues(array);
  return Array.from(array, (byte) => charset[byte % charset.length]).join('');
}
