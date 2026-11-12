import type { RunHistoryIndexer, RunHistoryIndexerState, RunHistoryMetricReader, RunHistoryStore } from '../../ports/run-history.js';
import { HistoryTurn, HistoryTurnRetired } from './turn.js';
export interface RunHistoryIndexOptions {
  readonly store: RunHistoryStore;
  readonly metrics: RunHistoryMetricReader;
  /** Fixed safe notification; must not await this indexer's close. */
  readonly onFailure: (problem: 'deadline' | 'operation') => Promise<void>;
  readonly intervalMs?: number;
}
/** One original, no queue; expiry fences independently but never releases custody. */
export function startRunHistoryIndexer(options: RunHistoryIndexOptions): RunHistoryIndexer {
  const store = { scan: options.store.scan.bind(options.store), defer: options.store.defer.bind(options.store), commit: options.store.commit.bind(options.store) };
  const metrics = { readRunHistorySummary: options.metrics.readRunHistorySummary.bind(options.metrics) };
  const onFailure = options.onFailure; const interval = options.intervalMs ?? 1000;
  if (typeof onFailure !== 'function' || !Number.isSafeInteger(interval) || interval < 25 || interval > 60000) throw new Error('Invalid history index configuration');
  let status: RunHistoryIndexerState['status'] = 'running'; let problem: RunHistoryIndexerState['problem'] = null;
  let active: { turn: HistoryTurn; original: Promise<void> } | undefined;
  let scheduled: ReturnType<typeof setTimeout> | undefined;
  let notification: Promise<void> = Promise.resolve(); let failure: { error: unknown } | undefined; let closing: Promise<void> | undefined;
  function fail(value: 'deadline' | 'operation', error: unknown): void {
    if (status === 'failed') return;
    status = 'failed'; problem = value; failure = { error }; active?.turn.controller.abort();
    notification = Promise.resolve().then(() => onFailure(value)).catch(error => { failure = { error: new AggregateError([failure?.error, error], 'History indexing notification failed') }; });
  }
  function schedule(): void { if (status === 'running') scheduled = setTimeout(tick, interval); }
  function tick(): void {
    scheduled = undefined; if (status !== 'running' || active) return;
    const turn = new HistoryTurn(() => fail('deadline', new Error('History indexing deadline')));
    const original = Promise.resolve().then(() => turn.run(store, metrics)).catch(error => {
      if (status === 'running') fail(performance.now() >= turn.deadline ? 'deadline' : 'operation', error);
      else if (status === 'closed' && !(error instanceof HistoryTurnRetired)) fail('operation', error);
    }).finally(() => { turn.dispose(); active = undefined; schedule(); });
    active = { turn, original };
  }
  scheduled = setTimeout(tick, 0);
  return Object.freeze({ state: () => ({ status, active: active !== undefined, problem }), close() {
    if (closing) return closing;
    if (scheduled !== undefined) clearTimeout(scheduled);
    if (status === 'running') status = 'closed'; active?.turn.controller.abort();
    closing = Promise.resolve(active?.original).then(async () => {
      await notification;
      if (failure !== undefined) throw failure.error;
    });
    return closing;
  } });
}
