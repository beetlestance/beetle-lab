interface Waiting { start(): void; reject(error: Error): void; retire(): void }
/** One original read, four waiting intents, and a five-second admission deadline. */
export class ReadGate {
  private active = false;
  private closed = false;
  private readonly waiting: Waiting[] = [];
  run<T>(signal: AbortSignal | undefined, work: () => Promise<T>): Promise<T> {
    if (this.closed || signal?.aborted) return Promise.reject(new Error('Read retired'));
    if (!this.active) return this.start(work);
    if (this.waiting.length >= 4) return Promise.reject(new Error('Read capacity unavailable'));
    return new Promise<T>((resolve, reject) => {
      const remove = () => { const index = this.waiting.indexOf(entry); if (index >= 0) this.waiting.splice(index, 1); };
      const abort = () => { remove(); entry.retire(); reject(new Error('Read retired')); };
      const timer = setTimeout(abort, 5000);
      const entry: Waiting = {
        start: () => { entry.retire(); resolve(this.start(work)); }, reject,
        retire: () => { clearTimeout(timer); signal?.removeEventListener('abort', abort); },
      };
      signal?.addEventListener('abort', abort, { once: true });
      this.waiting.push(entry);
    });
  }
  private start<T>(work: () => Promise<T>): Promise<T> {
    this.active = true;
    return Promise.resolve().then(work).finally(() => {
      this.active = false;
      this.waiting.shift()?.start();
    });
  }
  close(): void {
    this.closed = true;
    for (const entry of this.waiting.splice(0)) { entry.retire(); entry.reject(new Error('Read retired')); }
    // The original retains admission until it settles; cancellation is owned by its caller.
  }
}
