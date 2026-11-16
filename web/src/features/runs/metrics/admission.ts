/** One exposed API original across catalogue, selection replacements and effects. */
export interface ReadToken { readonly controller: AbortController; readonly signal: AbortSignal; current: boolean }
export class ReadAdmission {
  private active: ReadToken | undefined;
  private readonly listeners = new Set<() => void>();
  get busy(): boolean {return this.active !== undefined;}
  subscribe(listener: () => void): () => void {this.listeners.add(listener); return () => {this.listeners.delete(listener);};}
  run<T>(work: (token: ReadToken) => Promise<T>): {token: ReadToken; original: Promise<T>} | undefined {
    if (this.active) return;
    const controller = new AbortController(); const token = {controller, signal: controller.signal, current: true};
    this.active = token;
    for (const listener of [...this.listeners]) listener();
    const original = Promise.resolve().then(() => work(token)).finally(() => {
      if (this.active === token) this.active = undefined;
      for (const listener of [...this.listeners]) listener();
    });
    return {token, original};
  }
  async whenIdle(signal: AbortSignal): Promise<void> {
    if (!this.busy) return;
    await new Promise<void>((resolve, reject) => {
      const check = () => {if (!this.busy) {cleanup(); resolve();}};
      const abort = () => {cleanup(); reject(new Error('Metric wait retired'));};
      const cleanup = () => {this.listeners.delete(check); signal.removeEventListener('abort', abort);};
      this.listeners.add(check); signal.addEventListener('abort', abort, {once: true});
      if (signal.aborted) abort(); else check();
    });
  }
  retire(token: ReadToken): void {token.current = false;}
}
