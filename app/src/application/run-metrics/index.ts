import type { RunKey } from '../../ports/runs.js';
import { captureHistoryKey, historyProjection } from './history.js';
import { captureLookupQuery, lookup, metricSource } from './lookup.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import { captureRunMetricSeriesCursor, encodeRunMetricSeriesCursor, runMetricSeriesPageMatches, runMetricSamplesPageMatches, validateApi } from '@beetle/contracts/api';
import type { RunMetricSeriesPage } from '@beetle/contracts/api';
import type { RunMetricLookupQuery, RunMetricsService, RunMetricServiceOptions, MetricReadContext, RunMetricSeriesQuery, RunMetricSamplesQuery } from '../../ports/run-metrics.js';
import { encodeJson } from '@beetle/contracts';
import { SemanticError } from '../../domain/namespaces/index.js';
import { publication } from './archive.js';
import type { Publication } from './archive.js';
import { ArchiveIO } from './io.js';
import { MetricReadOperation as Operation } from '../metric-read-lifetime/index.js';
import { descriptor, fail } from './values.js';
import { samples } from './samples.js';
function unavailable(q: RunMetricSeriesQuery, p: Publication): RunMetricSeriesPage {
  if (q.cursor !== undefined) throw new SemanticError('invalid_value');
  return {...metricSource(q, p), items: [], nextCursor: null};
}
function cataloguePosition(q: RunMetricSeriesQuery, p: Publication): number {
  const start = catalogueCursor(q.cursor);
  if (!start) return 0;
  const expected = {organizationId: q.scope.organizationId, workspaceId: q.scope.workspaceId,
    runId: q.id, attemptId: q.attemptId, manifestDigest: p.page.manifestDigest};
  if (Object.keys(expected).some(k => start[k as keyof typeof start] !== expected[k as keyof typeof expected])) throw new SemanticError('invalid_value');
  if (start.nextOrdinal >= p.archive!.numeric.totals.length) throw new SemanticError('invalid_value'); return start.nextOrdinal;
}
function series(q: RunMetricSeriesQuery, p: Publication): RunMetricSeriesPage {
  const a = p.archive; if (!a) return unavailable(q, p);
  const first = cataloguePosition(q, p); const totals = a.numeric.totals;
  const items = totals.slice(first, first + q.limit).map((total, i) => descriptor(total, first + i));
  const ordinal = first + items.length;
  return {...metricSource(q, p), items,
    nextCursor: ordinal < totals.length ? encodeRunMetricSeriesCursor({organizationId: q.scope.organizationId, workspaceId: q.scope.workspaceId,
      runId: q.id, attemptId: q.attemptId, manifestDigest: p.page.manifestDigest!, nextOrdinal: ordinal}) : null};
}
/** One operation, no queue. Cancellation fences reads without releasing original ownership. */
export function createRunMetricsService(options: RunMetricServiceOptions): RunMetricsService {
  const artifacts = {listRunArtifacts: options.artifacts.listRunArtifacts.bind(options.artifacts), getRunArtifact: options.artifacts.getRunArtifact.bind(options.artifacts)};
  const bytes = options.bytes ? {read: options.bytes.read.bind(options.bytes)} : undefined;
  const createDigest = options.createDigest; let active: {owner: Operation; original: Promise<unknown>} | undefined;
  let closed = false; let closing: Promise<void> | undefined;
  function run<T>(q: RunMetricSeriesQuery, context: MetricReadContext, work: (q: RunMetricSeriesQuery, p: Publication, io?: ArchiveIO) => Promise<T>, actualOriginal = false): Promise<T> {
    if (closed || active) return Promise.reject(new MetricReadError(closed ? 'closed' : 'busy'));
    let captured: RunMetricSeriesQuery; let owner: Operation;
    try {
      captured = captureQuery(q); owner = new Operation(context);
    } catch (e) { return Promise.reject(e); }
    const original = Promise.resolve().then(async () => {
      owner.check(); const io = bytes && createDigest ? new ArchiveIO(bytes, createDigest, owner) : undefined;
      const p = await publication(artifacts, captured, io, owner); owner.check();
      const result = await work(captured, p, io); owner.check(); return result;
    }).finally(() => {owner.dispose(); active = undefined;});
    active = {owner, original}; return actualOriginal ? original : owner.race(original);
  }
  return Object.freeze({
    readRunHistorySummary(key: RunKey & { attemptId: string }, context: MetricReadContext) {
      let captured;
      try { captured = captureHistoryKey(key); } catch (error) { return Promise.reject(error); }
      return run({ ...captured, limit: 1 }, context, async (_captured, p) => historyProjection(p), true);
    },
    lookupRunMetricSeries(q: RunMetricLookupQuery, c: MetricReadContext) {
      let input;
      try {input = captureLookupQuery(q);} catch (error) {return Promise.reject(error);}
      return run({id: input.id, scope: input.scope, attemptId: input.attemptId, limit: 1}, c,
        async (captured, p) => lookup(captured, p, input.metric), true);
    }, reader: Object.freeze({
    listRunMetricSeries(q: RunMetricSeriesQuery, c: MetricReadContext) {
      return run(q, c, async (captured, p) => {
        const value = series(captured, p); if (!validateApi('RunMetricSeriesPage', value).ok || !runMetricSeriesPageMatches(value, captured)) return fail(); return value;
      });
    },
    getRunMetricSamples(q: RunMetricSamplesQuery, c: MetricReadContext) {
      return run(q, c, async (captured, p, io) => {
        if (!io || !p.archive) throw new MetricReadError('unavailable');
        const query = captured as RunMetricSamplesQuery;
        if (!validateApi('RunMetricSamplesQuery', {limit: query.limit, seriesOrdinal: query.seriesOrdinal,
          ...(query.cursor === undefined ? {} : {cursor: query.cursor}), ...(query.fromTimeMs === undefined ? {} : {fromTimeMs: query.fromTimeMs}),
          ...(query.toTimeMs === undefined ? {} : {toTimeMs: query.toTimeMs})}).ok) throw new SemanticError('invalid_value');
        const value = await samples(io, p.archive, query);
        if (!validateApi('RunMetricSamplesPage', value).ok || !runMetricSamplesPageMatches(value, query)) return fail(); return value;
      });
    }}), close() {
      closed = true; active?.owner.controller.abort();
      closing ??= Promise.allSettled([active?.original]).then(() => undefined); return closing;
    }});
}
function catalogueCursor(cursor: string | undefined) {
  if (cursor === undefined) return null;
  try {return captureRunMetricSeriesCursor(cursor);} catch {throw new MetricReadError('invalid_input');}
}
function captureQuery(input: unknown): RunMetricSeriesQuery {
  let q: RunMetricSeriesQuery;
  try {q = JSON.parse(encodeJson(input, 4096)) as RunMetricSeriesQuery;} catch {throw new MetricReadError('invalid_input');}
  if (!q || !validateApi('WorkspaceScope', q.scope).ok) throw new MetricReadError('invalid_input');
  const valid = validateApi('RunAttemptParams', {organizationId: q.scope.organizationId, workspaceId: q.scope.workspaceId, runId: q.id, attemptId: q.attemptId});
  if (!valid.ok || !Number.isSafeInteger(q.limit) || q.limit < 1 || q.limit > 100) throw new MetricReadError('invalid_input');
  return {...q, id: q.id.toLowerCase(), attemptId: q.attemptId.toLowerCase(), scope: {...q.scope,
    organizationId: q.scope.organizationId.toLowerCase(), workspaceId: q.scope.workspaceId.toLowerCase()}};
}
