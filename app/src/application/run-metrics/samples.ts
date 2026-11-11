import { captureMetricWindow, metricSeriesIdentity } from '@beetle/contracts/metrics';
import { captureRunMetricSamplesCursor, encodeRunMetricSamplesCursor } from '@beetle/contracts/api';
import type { RunMetricSamplesPage } from '@beetle/contracts/api';
import type { RunMetricSamplesQuery } from '../../ports/run-metrics.js';
import { MetricReadError } from '../../ports/run-metrics.js';
import { SemanticError } from '../../domain/namespaces/index.js';
import { fields, safe, fail, descriptor, metricValue } from './values.js';
import { archiveHeader, indexEnd } from './archive.js';
import type { ReadyArchive } from './archive.js';
import type { ArchiveIO } from './io.js';
export interface Row { sequence: number; startTimeMs: number; endTimeMs: number; offset: number; length: number }
function position(q: RunMetricSamplesQuery, a: ReadyArchive) {
  const fromTimeMs = q.fromTimeMs ?? 0; const toTimeMs = q.toTimeMs ?? 8640000000000000;
  if (fromTimeMs >= toTimeMs) throw new SemanticError('invalid_value');
  const base = {organizationId: q.scope.organizationId, workspaceId: q.scope.workspaceId, runId: q.id,
    attemptId: q.attemptId, manifestDigest: a.page.manifestDigest!, seriesOrdinal: q.seriesOrdinal, fromTimeMs, toTimeMs};
  const start = samplesCursor(q.cursor);
  if (start && Object.keys(base).some(k => start[k as keyof typeof start] !== base[k as keyof typeof base])) throw new SemanticError('invalid_value');
  const beforeWindow = start?.beforeWindow ?? a.numeric.windows;
  if (beforeWindow > a.numeric.windows) throw new SemanticError('invalid_value');
  return {...base, beforeWindow};
}
async function scan(io: ArchiveIO, a: ReadyArchive, q: RunMetricSamplesQuery, p: ReturnType<typeof position>): Promise<{rows: Row[]; older: boolean}> {
  const rows: Row[] = []; let sequence = 0; let offset = a.headerBytes; let through = 0; let ended = false; let first = true; let eligible = 0;
  await io.lines(a.index, {start: 0, end: a.index.artifact.bytes}, 1024, (value, bytes) => {
    if (first) { first = false; archiveHeader(value, 'beetle-k6-metric-index', a); return; }
    if (ended || bytes > 256) return fail();
    if ((value as {kind?: unknown})?.kind === 'end') { indexEnd(value, a); ended = true; return; }
    const row = captureRow(value);
    rowOrder(row, sequence, through, offset);
    sequence++; through = row.endTimeMs; offset += row.length;
    if (!Number.isSafeInteger(offset) || offset > a.data.artifact.bytes - a.footerBytes) return fail();
    if (selectedRow(row, p)) {
      eligible++; retain(rows, row, q.limit);
    }
  }, true);
  if (!ended || sequence !== a.numeric.windows || offset + a.footerBytes !== a.data.artifact.bytes) return fail();
  return {rows, older: eligible > rows.length};
}
export async function samples(io: ArchiveIO, a: ReadyArchive, q: RunMetricSamplesQuery): Promise<RunMetricSamplesPage> {
  const total = a.numeric.totals[q.seriesOrdinal]; if (!total) throw new SemanticError('not_found');
  const p = position(q, a); const {rows, older} = await scan(io, a, q, p);
  const items: RunMetricSamplesPage['items'] = []; const known = new Set(a.numeric.totals.map(metricSeriesIdentity)); let n = 0;
  if (rows.length) await io.lines(a.data, {start: rows[0]!.offset, end: rows.at(-1)!.offset + rows.at(-1)!.length}, 1048576, (input, bytes) => {
    const row = rows[n++]; if (!row) return fail(); const v = fields(input, ['kind', 'sequence', 'window']);
    if (v.kind !== 'window' || v.sequence !== row.sequence || bytes !== row.length) return fail();
    const window = decodeWindow(v.window);
    if (window.startTimeMs !== row.startTimeMs || window.endTimeMs !== row.endTimeMs
      || window.series.some(s => !known.has(metricSeriesIdentity(s)))) return fail();
    const value = window.series.find(s => metricSeriesIdentity(s) === metricSeriesIdentity(total));
    if (value) items.push({windowOrdinal: row.sequence, startTimeMs: row.startTimeMs, endTimeMs: row.endTimeMs, value: metricValue(value.total)});
  });
  if (n !== rows.length) return fail();
  const firstWindow = rows[0]?.sequence ?? 0;
  return {id: q.id, scope: q.scope, attemptId: q.attemptId, generation: 1, manifestDigest: a.page.manifestDigest!,
    series: descriptor(total, q.seriesOrdinal), coverage: a.numeric.coverage, measurementSourceTimeMs: a.numeric.sourceTimeMs,
    windows: a.numeric.windows, fromTimeMs: p.fromTimeMs, toTimeMs: p.toTimeMs, examined: rows.length, beforeWindow: p.beforeWindow,
    firstWindow, span: rows.length ? {startTimeMs: rows[0]!.startTimeMs, endTimeMs: rows.at(-1)!.endTimeMs} : null,
    items, nextCursor: older ? encodeRunMetricSamplesCursor({...p, beforeWindow: firstWindow - 1}) : null};
}
function captureRow(value: unknown): Row {
  const v = fields(value, ['sequence', 'startTimeMs', 'endTimeMs', 'offset', 'length']);
  return {sequence: safe(v.sequence, 65536), startTimeMs: safe(v.startTimeMs, 8640000000000000),
    endTimeMs: safe(v.endTimeMs, 8640000000000000), offset: safe(v.offset), length: safe(v.length, 1048576)};
}
function rowOrder(row: Row, sequence: number, through: number, offset: number): void {
  if (row.sequence !== sequence + 1 || row.startTimeMs < through || row.endTimeMs - row.startTimeMs !== 1000
    || row.offset !== offset || row.length < 1) return fail();
}
function selectedRow(row: Row, p: ReturnType<typeof position>): boolean {
  return row.sequence <= p.beforeWindow && row.endTimeMs > p.fromTimeMs && row.startTimeMs < p.toTimeMs;
}
function retain(rows: Row[], row: Row, limit: number): void {
  rows.push(row); if (rows.length > limit) rows.shift();
  while (rows.length && row.offset + row.length - rows[0]!.offset > 8388608) rows.shift();
}
function samplesCursor(cursor: string | undefined) {
  if (cursor === undefined) return null;
  try {return captureRunMetricSamplesCursor(cursor);} catch {throw new MetricReadError('invalid_input');}
}
function decodeWindow(value: unknown) {
  try {return captureMetricWindow(value);} catch {return fail();}
}
