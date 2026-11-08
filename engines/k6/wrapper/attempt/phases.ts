import { encodeJson } from '@beetle/contracts';
import type { ControlEvent, EngineManifest, EngineResult } from '@beetle/contracts';
import type { StagedHeaders } from '../input/index.js';
import type { ControlDraft, ControlWriter, JournalScope } from '../control/index.js';
import { AttemptError } from './types.js';
import type { AttemptFence } from './fence.js';
import type { Notifications } from './notifications.js';
type Phase = EngineManifest['phases'][number]['phase'];

/** Serial durable lifecycle owner; heartbeat has no backlog and no independent load work. */
export class Phases {
  private active: Phase = 'validate';
  private timer: ReturnType<typeof setTimeout> | undefined;
  private heartbeat: Promise<void> | undefined;
  private failure = false;
  constructor(private readonly writer: ControlWriter, private readonly scope: JournalScope,
    private readonly manifest: StagedHeaders['manifest'], private readonly fence: AttemptFence,
    private readonly notifications: Notifications) {}
  private draft(event: Pick<ControlDraft, 'kind' | 'payload'>, observedAt = this.fence.timestamp()): ControlDraft {
    return { version: '1.0', ...this.scope, phase: this.active, observedAt, ...event } as ControlDraft;
  }
  private async append(event: ControlDraft): Promise<ControlEvent> {
    if (this.failure) throw new AttemptError('journal');
    let stored: ControlEvent;
    try { stored = await this.writer.append(event, this.fence.budget()); }
    catch { this.failure = true; this.fence.stop('journal'); throw new AttemptError('journal'); }
    await this.notifications.send(stored); this.fence.check(); return stored;
  }
  async start(phase: Phase, observedAt?: string): Promise<void> {
    this.active = phase;
    const budget = this.manifest.phases.find(item => item.phase === phase);
    if (!budget) throw new AttemptError('profile');
    if (phase !== 'validate') this.fence.phase(budget.timeoutMs);
    await this.append(this.draft({ kind: 'phase.started', payload: { budget: { ...budget, workUnits: 1 } } }, observedAt));
    this.schedule();
  }
  private schedule(): void {
    clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.heartbeat = this.append(this.draft({ kind: 'progress', payload: {
        completedUnits: 0, totalUnits: 1, heartbeat: true, usefulProgress: false } })).then(() => undefined);
      void this.heartbeat.then(() => { this.heartbeat = undefined; this.schedule(); }, () => undefined);
    }, 5000);
    this.timer.unref();
  }
  async finish(completedUnits: 0 | 1, outputBytes = 0): Promise<void> {
    clearTimeout(this.timer); await this.heartbeat;
    if (outputBytes > this.manifest.phases.find(item => item.phase === this.active)!.outputBytes) {
      this.fence.stop('output_limit'); throw new AttemptError('output_limit');
    }
    await this.append(this.draft({ kind: 'phase.finished', payload: { completedUnits, outputBytes } }));
  }
  async transition(phase: Phase, completed: 0 | 1, observedAt?: string, outputBytes = 0): Promise<void> {
    await this.finish(completed, outputBytes); await this.start(phase, observedAt);
  }
  /** Check the entire final envelope (including worst-case sequence and LF) before publication. */
  resultDraft(result: EngineResult): ControlDraft {
    const event = this.draft({ kind: 'engine.result', payload: result });
    try { encodeJson({ ...event, seq: 65_536 }, 65_535); }
    catch { throw new AttemptError('output_limit'); }
    return event;
  }
  async result(event: ControlDraft): Promise<void> {
    clearTimeout(this.timer); await this.heartbeat; await this.append(event);
  }
  async stop(): Promise<void> { clearTimeout(this.timer); await this.heartbeat; }
}
