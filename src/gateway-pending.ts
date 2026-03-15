export interface PendingRequest {
  id: string;
  method: string;
  resolve: (value: unknown) => void;
  reject: (err: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class PendingRequestStore {
  private pending = new Map<string, PendingRequest>();

  add(
    id: string,
    method: string,
    timeoutMs: number,
    resolve: (value: unknown) => void,
    reject: (err: Error) => void,
    onTimeout?: (method: string, timeoutMs: number) => void
  ): void {
    const timer = setTimeout(() => {
      if (!this.pending.has(id)) {
        return;
      }
      this.pending.delete(id);
      onTimeout?.(method, timeoutMs);
      reject(new Error(`Gateway request "${method}" timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    this.pending.set(id, { id, method, resolve, reject, timer });
  }

  get(id: string): PendingRequest | undefined {
    return this.pending.get(id);
  }

  take(id: string): PendingRequest | undefined {
    const pending = this.pending.get(id);
    if (!pending) {
      return undefined;
    }
    clearTimeout(pending.timer);
    this.pending.delete(id);
    return pending;
  }

  has(id: string): boolean {
    return this.pending.has(id);
  }

  clear(err: Error): void {
    for (const [, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(err);
    }
    this.pending.clear();
  }

  get size(): number {
    return this.pending.size;
  }
}
