import { MetricReadError } from '../../ports/run-metrics.js';
import type { MetricReadContext } from '../../ports/run-metrics.js';
import type { MetricReadOperation } from '../metric-read-lifetime/index.js';
interface WaitingRead {
  start(): void;
  abort(): void;
}
/** One bounded successor to a background history read; it owns no parser or native IO. */
export class HistoryReadWaiter {
  private entry: WaitingRead | undefined;
  get busy(): boolean {
    return this.entry !== undefined;
  }
  wait<T>(owner: MetricReadOperation, start: (context: MetricReadContext) => Promise<T>): Promise<T> {
    if (this.entry) {
      owner.dispose();
      return Promise.reject(new MetricReadError('busy'));
    }
    return new Promise<T>((resolve, reject) => {
      const retire = () => {
        owner.dispose();
        owner.signal.removeEventListener('abort', abort);
        if (this.entry === entry) this.entry = undefined;
      };
      const abort = () => {
        retire();
        reject(new MetricReadError('unavailable'));
      };
      const entry: WaitingRead = {
        start: () => {
          retire();
          try {
            owner.check();
            resolve(start({ signal: owner.signal, deadline: owner.deadline }));
          } catch (error) {
            reject(error);
          }
        },
        abort: () => owner.controller.abort(),
      };
      this.entry = entry;
      owner.signal.addEventListener('abort', abort, { once: true });
      if (owner.signal.aborted) abort();
    });
  }
  start(): void {
    this.entry?.start();
  }
  close(): void {
    this.entry?.abort();
  }
}
