/**
 * 按资源键串行执行异步操作。
 *
 * 同一个键上的调用严格按进入顺序排队；不同键互不阻塞。前一个操作失败不会阻断
 * 后续队列，队尾完成后会自动移除，避免长期持有已经不用的实例 ID。
 */
export class KeyedOperationLock {
  private readonly tails = new Map<string, Promise<void>>();

  runExclusive<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const result = previous.catch(() => undefined).then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.tails.set(key, tail);
    return result.finally(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
  }
}
