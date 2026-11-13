import { pendingRunHistorySummary, runHistorySummaryMatches } from '@beetle/contracts/api';
import type { RunHistorySummary } from '@beetle/contracts/api';
import { MetricReadError } from '../../ports/run-metrics.js';
import type { RunHistoryJob, HistoryJobRetirement, RunHistoryStore, RunHistoryMetricReader } from '../../ports/run-history.js';

export class HistoryTurnRetired extends Error { constructor() { super('History indexing turn retired'); } }
export class HistoryTurn {
  readonly controller = new AbortController();
  readonly deadline = performance.now() + 45000;
  private readonly timer: ReturnType<typeof setTimeout>;
  constructor(expired: () => void) { this.timer = setTimeout(() => { this.controller.abort(); expired(); }, 45000); }
  check(): void {
    if (this.controller.signal.aborted || performance.now() >= this.deadline) throw new HistoryTurnRetired();
  }
  dispose(): void { clearTimeout(this.timer); }
  async run(store: RunHistoryStore, metrics: RunHistoryMetricReader): Promise<void> {
    this.check(); const jobs = await store.scan({ nowMs: Date.now(), limit: 1 }); this.check();
    const job = jobs[0]; if (!job) return;
    const retirement=await store.retirement(job);this.check();
    if(retirement){if(retirement.state==='deleting')await this.defer(store,job,30000);return;}
    if (job.manifestDigest === null && job.absenceProofDigest === null) { await this.defer(store, job, 30000); return; }
    const summary = await this.project(store,metrics, job); this.check();
    await this.finish(store,job,summary);
  }
  private async finish(store:RunHistoryStore,job:RunHistoryJob,summary:RunHistorySummary|HistoryJobRetirement|null):Promise<void>{
    if(summary&&'state' in summary){if(summary.state==='deleting')await this.defer(store,job,30000);return;}
    if (summary === null) { await this.defer(store, job, 1000); return; }
    if (summary.availability === 'pending') { await this.defer(store, job, 30000); return; }
    if (!runHistorySummaryMatches(summary, { id: job.id, activeAttemptId: job.attemptId })) throw new Error('Invalid indexed history summary');
    this.check(); await store.commit({ job, summary }); this.check();
  }
  private async project(store:RunHistoryStore,metrics: RunHistoryMetricReader, job: RunHistoryJob): Promise<RunHistorySummary | HistoryJobRetirement | null> {
    const base = pendingRunHistorySummary({ id: job.id, activeAttemptId: job.attemptId });
    try {
      const projection = await metrics.readRunHistorySummary({ id: job.id, scope: job.scope, attemptId: job.attemptId },
        { signal: this.controller.signal, deadline: this.deadline });
      this.check(); return { ...base, ...projection };
    } catch (error) {
      this.check();
      if(error instanceof MetricReadError&&error.code==='busy')return null;
      const retired=await store.retirement(job);this.check();if(retired)return retired;
      if (!(error instanceof MetricReadError)) throw error;
      if (!['integrity', 'unavailable', 'deadline'].includes(error.code)) throw error;
      return { ...base, availability: 'unavailable' };
    }
  }
  private async defer(store: RunHistoryStore, job: RunHistoryJob, delayMs: number): Promise<void> {
    this.check(); await store.defer({ job, dueMs: Date.now() + delayMs }); this.check();
  }
}
