import { StorageError } from './protocol.js';

/**
 * A live capacity observation lasts about one second and is renewed every few hundred
 * milliseconds, so a slow poll can leave a short gap. Operations that require live
 * capacity wait, bounded, for the next accepted observation and try once more instead
 * of answering 503 for that gap. Only a definite `capacity_unavailable` refusal is
 * retried; the worker rolls such a refusal back, so nothing was committed.
 */
export class CapacityWait {
  private readonly waiters = new Set<() => void>();
  constructor(private readonly limitMs = 2000) {}

  /** A non-null observation was accepted by the store. */
  accepted(): void {
    const waiters = [...this.waiters];
    this.waiters.clear();
    waiters.forEach((wake) => wake());
  }

  async retry<T>(attempt: () => Promise<T>): Promise<T> {
    try {
      return await attempt();
    } catch (error) {
      if (!(error instanceof StorageError) || error.code !== 'capacity_unavailable') throw error;
      if (!(await this.next())) throw error;
      return attempt();
    }
  }

  private next(): Promise<boolean> {
    return new Promise((resolve) => {
      const wake = () => {
        clearTimeout(timer);
        resolve(true);
      };
      const timer = setTimeout(() => {
        this.waiters.delete(wake);
        resolve(false);
      }, this.limitMs);
      this.waiters.add(wake);
    });
  }
}
