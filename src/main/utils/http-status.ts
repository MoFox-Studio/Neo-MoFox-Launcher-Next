/** 常见 HTTP 状态码到人类可读原因的描述；未收录的状态码返回 undefined。 */
const HTTP_STATUS_EXPLANATIONS: Record<number, string> = {
  400: '请求参数不合法',
  401: '未授权，可能需要提供访问令牌',
  403: '访问被拒绝；GitHub API 触发限流或镜像源拒绝该请求时常见',
  404: '资源不存在，仓库或发行版可能已被删除、改名或设为私有',
  405: '请求方法不被允许',
  408: '请求超时',
  416: '请求的字节范围不满足服务端条件',
  429: '请求过于频繁，触发限流，请稍后重试',
  500: '服务器内部错误',
  502: '网关错误，上游服务器（GitHub 或镜像源）异常',
  503: '服务暂时不可用',
  504: '网关超时，上游服务器响应过慢',
};

/**
 * 将 HTTP 状态码转换为人类可读的原因描述，供错误提示使用。
 *
 * @param status - HTTP 状态码。
 * @returns 状态码对应的中文原因描述；未收录时返回通用描述。
 */
export function describeHttpStatus(status: number): string {
  return HTTP_STATUS_EXPLANATIONS[status] ?? '未知的 HTTP 状态码';
}