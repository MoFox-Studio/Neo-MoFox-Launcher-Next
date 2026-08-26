import { describe, expect, it } from 'vitest';
import { describeHttpStatus } from '../../../src/main/utils/http-status';

describe('describeHttpStatus', () => {
  it('explains common status codes', () => {
    expect(describeHttpStatus(403)).toContain('访问被拒绝');
    expect(describeHttpStatus(404)).toContain('资源不存在');
    expect(describeHttpStatus(429)).toContain('限流');
    expect(describeHttpStatus(503)).toContain('服务暂时不可用');
  });

  it('falls back for unknown status codes', () => {
    expect(describeHttpStatus(599)).toBe('未知的 HTTP 状态码');
  });
});