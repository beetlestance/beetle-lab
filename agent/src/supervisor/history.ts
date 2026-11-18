import type { Operation } from '../backends/docker/index.js';
import type { PrefixHistory, PrefixRead } from '../collection/live-history/index.js';
import type { LiveMetricRead } from '../live-metrics/index.js';
import type { SamplingAdmission } from '../telemetry/index.js';
import type { Clock, LaunchInput, HistoryReader } from './types.js';
export type HistoryRead = { ok: true; value: PrefixHistory } | { ok: false; reason: 'closed' | 'busy' | 'unavailable' };
interface Options {
  input: LaunchInput;
  clock: Clock;
  admission: SamplingAdmission;
  read(operation: Operation): Promise<LiveMetricRead>;
  history?: HistoryReader;
}
/** One advisory bootstrap original, held through native quiescence and actual closes. */
export class AttemptHistory {
  private original: Promise<HistoryRead> | undefined;
  private closing: Promise<void> | undefined;
  private readonly controller = new AbortController();
  private failed = false;
  constructor(private readonly options: Options) {}
  get pending(): boolean {
    return this.original !== undefined || this.failed;
  }
  read(operation: Operation): Promise<HistoryRead> {
    if (this.closing) return Promise.resolve({ ok: false, reason: 'closed' });
    if (!this.options.history || this.failed) return Promise.resolve({ ok: false, reason: 'unavailable' });
    if (this.original) return Promise.resolve({ ok: false, reason: 'busy' });
    const release = this.options.admission.acquire();
    if (!release) return Promise.resolve({ ok: false, reason: 'busy' });
    const original = Promise.resolve()
      .then(() => this.capture(operation))
      .finally(() => {
        if (this.original === original) this.original = undefined;
        if (!this.failed) release();
      });
    this.original = original;
    return original;
  }
  close(): Promise<void> {
    if (!this.closing) {
      const original = this.original;
      this.controller.abort();
      this.closing = Promise.resolve().then(async () => {
        await original;
        if (this.failed) throw new Error('History native cleanup unavailable');
      });
      void this.closing.catch(() => undefined);
    }
    return this.closing;
  }
  private async capture(operation: Operation): Promise<HistoryRead> {
    try {
      if (!validOperation(operation)) return { ok: false, reason: 'unavailable' };
      const signal = AbortSignal.any([this.controller.signal, ...(operation.signal ? [operation.signal] : [])]);
      const deadline = Math.min(operation.deadline, this.options.clock.monotonic() + 30000);
      const current = await this.options.read({ deadline, signal });
      if (signal.aborted || this.closing) return { ok: false, reason: 'closed' };
      if (!current.ok || !current.frame.archivePrefix || this.options.clock.monotonic() >= deadline)
        return { ok: false, reason: 'unavailable' };
      const location = outputLocation(this.options.input);
      if (!location) return { ok: false, reason: 'unavailable' };
      const native = this.options.history!({
        ...location,
        scope: this.options.input.key,
        frame: current.frame,
        deadline,
        signal,
      });
      return await this.finish(native, signal);
    } catch {
      return { ok: false, reason: 'unavailable' };
    }
  }
  private async finish(native: PrefixRead, signal: AbortSignal): Promise<HistoryRead> {
    const [outcome] = await Promise.allSettled([native.result]);
    const close = Promise.resolve().then(() => native.close());
    const outcomes = await Promise.allSettled([native.quiesced, close]);
    if (outcomes.some((value) => value.status === 'rejected')) {
      this.failed = true;
      throw new Error('History native cleanup unavailable');
    }
    if (outcome.status === 'rejected') return { ok: false, reason: 'unavailable' };
    const result = outcome.value;
    if (signal.aborted || this.closing) return { ok: false, reason: 'closed' };
    return result.ok ? result : { ok: false, reason: result.reason === 'busy' ? 'busy' : 'unavailable' };
  }
}

function validOperation(operation: Operation): boolean {
  return (
    !!operation &&
    Number.isFinite(operation.deadline) &&
    (operation.signal === undefined || operation.signal instanceof AbortSignal)
  );
}
function outputLocation(input: LaunchInput): { directory: string; uid: number } | undefined {
  const mount = input.plan.spec.HostConfig.Mounts.find((value) => value.Target === '/beetle/output');
  if (!mount || mount.Type !== 'bind' || mount.ReadOnly) return undefined;
  return { directory: mount.Source, uid: Number(input.plan.spec.User.split(':')[0]) };
}
