/** 常见 HTTP 状态码到人类可读原因的描述；未收录的状态码返回 undefined。 */
const HTTP_STATUS_EXPLANATIONS: Record<number, string> = {
  400: '请求参数不合法',
  401: '未授权，可能需要提供访问令牌',
  403: '访问被拒绝；GitHub API 触发限流或镜像源拒绝该请求时常见',
  404: '资源不存在，仓库或发行版可能已被删除、改名或设为私有',
  405: '请求方法不被允许',
  408: '请求超时',
  410: '资源已永久移除',
  416: '请求的字节范围不满足服务端条件',
  429: '请求过于频繁，触发限流，请稍后重试',
  500: '服务器内部错误',
  502: '网关错误，上游服务器（GitHub 或镜像源）异常',
  503: '服务暂时不可用',
  504: '网关超时，上游服务器响应过慢',
};

/**
 * 网络层错误到人类可读原因的描述规则；按声明顺序匹配，命中即返回。
 *
 * 同时匹配 Node.js 错误码（如 `UNABLE_TO_VERIFY_LEAF_SIGNATURE`、`ENOTFOUND`）
 * 与错误消息文本，覆盖证书校验、域名解析、连接、超时、代理等常见失败场景。
 */
const NETWORK_ERROR_EXPLANATIONS: Array<{
  codes?: readonly string[];
  pattern?: RegExp;
  explanation: string;
}> = [
  {
    codes: ['AbortError', 'ERR_CANCELED', 'ERR_ABORTED'],
    pattern: /abort/i,
    explanation: '请求已取消',
  },
  {
    pattern: /proxy/i,
    explanation: '代理连接失败，请检查代理服务器地址与认证设置',
  },
  {
    codes: [
      'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
      'SELF_SIGNED_CERT_IN_CHAIN',
      'DEPTH_ZERO_SELF_SIGNED_CERT',
      'ERR_CERT_INVALID',
    ],
    pattern:
      /unable to verify the first certificate|self[ -]signed certificate|certificate verify failed/i,
    explanation:
      'TLS 证书校验失败，无法确认服务器身份，可能由中间人代理、未受信任的根证书或系统时间错误导致',
  },
  {
    codes: ['CERT_HAS_EXPIRED', 'CERTIFICATE_EXPIRE'],
    pattern: /certificate (has )?expired/i,
    explanation: 'TLS 证书已过期，请联系镜像源维护者更新证书',
  },
  {
    codes: [
      'ERR_TLS_CERT_ALTNAME_INVALID',
      'ERR_CERT_COMMON_NAME_INVALID',
      'ERR_CERT_HOSTNAME_MISMATCH',
    ],
    pattern: /hostname\/ip does not match certificate|altnames/i,
    explanation: 'TLS 证书与请求域名不匹配，可能遭遇中间人劫持或镜像源配置错误',
  },
  {
    codes: ['ERR_SSL_PROTOCOL_ERROR', 'ERR_SSL_NO_SHARED_CIPHER', 'ERR_SSL_WRONG_VERSION_NUMBER'],
    pattern: /ssl protocol error|no shared cipher|wrong version number/i,
    explanation: 'TLS 握手失败，服务器不支持当前协议版本或加密套件，或中间设备干扰了加密流量',
  },
  {
    codes: ['ENOTFOUND', 'EAI_AGAIN', 'EAI_NONAME'],
    pattern: /getaddrinfo|name or service not known|enotfound/i,
    explanation: '域名解析失败，请检查网络连接与 DNS 配置',
  },
  {
    codes: ['EHOSTUNREACH', 'ENETUNREACH', 'ENETDOWN'],
    explanation: '目标网络不可达，请检查网络连接或更换镜像源',
  },
  {
    codes: ['ECONNREFUSED'],
    pattern: /connection refused/i,
    explanation: '连接被拒绝，服务器未开放端口或防火墙拦截了请求',
  },
  {
    codes: ['ECONNRESET', 'EPIPE'],
    pattern: /connection reset|socket hang up|broken pipe/i,
    explanation: '连接被对端重置，网络不稳定或服务器异常中断了响应',
  },
  {
    codes: ['ETIMEDOUT', 'ESOCKETTIMEDOUT'],
    pattern: /timed ?out|timeout/i,
    explanation: '连接或响应超时，网络缓慢或服务器负载过高',
  },
  {
    codes: ['ERR_INVALID_URL', 'ERR_INVALID_PROTOCOL'],
    pattern: /invalid (url|protocol)/i,
    explanation: '请求地址无效，请检查镜像源配置是否正确',
  },
];

/**
 * 常见 Git 命令失败输出到人类可读原因的描述；按声明顺序匹配，命中即返回。
 *
 * Git 的传输层错误（clone/fetch/pull/ls-remote）常把底层原因一并写入 stderr，
 * 例如证书校验、域名解析、连接失败与代理故障，因此这里同时覆盖网络类问题。
 */
const GIT_ERROR_EXPLANATIONS: Array<{ pattern: RegExp; explanation: string }> = [
  {
    pattern:
      /SSL certificate problem|unable to get local issuer certificate|server certificate verification failed|self[- ]signed certificate|certificate verify failed/i,
    explanation:
      'Git 服务器证书校验失败，无法确认服务器身份，可能由中间人代理、未受信任的根证书或系统时间错误导致',
  },
  {
    pattern: /Authentication failed|could not read (Username|Password)|access denied/i,
    explanation: '认证失败，请检查访问令牌与账号权限（仓库可能已设为私有或令牌已过期）',
  },
  {
    pattern: /repository .* not found/i,
    explanation: '仓库不存在，可能已被删除、改名或设为私有',
  },
  {
    pattern: /already exists and is not an empty directory/i,
    explanation: '目标目录已存在且非空，请更换安装目录或先清理旧目录',
  },
  {
    pattern: /could not resolve host|getaddrinfo|ENOTFOUND|Name or service not known/i,
    explanation: '域名解析失败，请检查网络连接与 DNS 配置',
  },
  {
    pattern: /connection refused/i,
    explanation: '连接被拒绝，服务器未开放端口或防火墙拦截了请求',
  },
  {
    pattern: /connection (timed out|reset)|timed ?out/i,
    explanation: '连接或响应超时，网络缓慢或服务器负载过高',
  },
  {
    pattern: /proxy/i,
    explanation: '代理连接失败，请检查代理服务器地址与认证设置',
  },
  {
    pattern: /not a git repository/i,
    explanation: '目录不是有效的 Git 仓库',
  },
  {
    pattern: /remote .* already exists/i,
    explanation: '远程源已存在，请检查仓库配置',
  },
  {
    pattern: /unable to access/i,
    explanation: '无法访问远程仓库，请检查网络连接或更换镜像源',
  },
];

/**
 * 将 Git 命令的失败输出转换为人类可读的中文原因描述。
 *
 * 按声明顺序匹配 stderr 文本中的常见致命错误，给出可操作提示；无法识别时
 * 原样返回输入，避免丢失调试信息。
 *
 * @param output - Git 命令的 stderr 输出，可为空。
 * @returns 可读的中文原因描述或原始输出。
 */
export function describeGitError(output: string | undefined): string {
  const text = (output ?? '').trim();
  if (!text) return '未知的 Git 错误';
  for (const rule of GIT_ERROR_EXPLANATIONS) {
    if (rule.pattern.test(text)) return rule.explanation;
  }
  return text;
}

/**
 * 将请求失败原因转换为人类可读的中文描述，供错误提示使用。
 *
 * 支持两种输入：
 * - HTTP 状态码（number）：查表返回对应的中文原因。
 * - 请求过程中抛出的错误（Error）：按错误码与消息文本匹配证书、DNS、连接等网络问题；
 *   兼容 `fetch` 包装后置于 `cause` 的底层错误。
 *
 * @param error - HTTP 状态码或网络错误。
 * @returns 可读的中文原因描述；无法识别时返回带原始信息的兜底描述。
 */
export function describeNetworkError(error: unknown): string {
  if (typeof error === 'number') {
    return HTTP_STATUS_EXPLANATIONS[error] ?? `未知的 HTTP 状态码 ${error}`;
  }
  if (error instanceof Error) {
    const cause = error.cause instanceof Error ? error.cause : undefined;
    const candidates = [
      error as Error & { code?: unknown },
      ...(cause ? [cause as Error & { code?: unknown }] : []),
    ];
    for (const rule of NETWORK_ERROR_EXPLANATIONS) {
      for (const candidate of candidates) {
        if (typeof candidate.code === 'string' && rule.codes?.includes(candidate.code)) {
          return rule.explanation;
        }
        if (rule.pattern && rule.pattern.test(candidate.message)) {
          return rule.explanation;
        }
      }
    }
    return `未知的网络错误（${error.message}）`;
  }
  return '未知的网络错误';
}
