import assert from 'node:assert/strict';
import {nativeFailure, nativeFailureCodes} from '../compose/failure.js';
const files = ['candidate', 'measure', 'observe', 'run', 'network', 'poll', 'rss-capture', 'rss-observe', 'rss-run'];
const phases = ['startup', 'idle', 'loaded', 'post-idle'];
function row(input: unknown): Record<string, unknown> {return input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};}
function number(input: unknown, maximum: number): number | null {return typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= maximum ? input : null;}
function member(input: unknown, allowed: readonly string[]) {return typeof input === 'string' && allowed.includes(input) ? input : null;}
export function shortFailure(error: unknown) {
 const known = nativeFailure(error); if (!(error instanceof Error)) return known;
 const match = /native-application\/load\/(candidate|measure|observe|run|network|poll)\.(?:ts|js):(\d{1,4}):(\d{1,4})\b/.exec(error.stack ?? '');
 return {...known, site: match ? {file: match[1]!, line: Number(match[2]), column: Number(match[3])} : known.site};
}
function diagnosis(input: unknown) {
 const value = row(input); const site = row(value.site); const file = member(site.file, [...files, 'smoke', 'fixture', 'public', 'public-api', 'evidence']);
 const line = number(site.line, 9999); const column = number(site.column, 9999);
 return {code: member(value.code, [...nativeFailureCodes]) ?? 'internal', site: file && line && column ? {file, line, column} : null};
}
function window(input: unknown) {
 const value = row(input); const calls = Array.isArray(value.calls) && value.calls.length <= 512 ? value.calls.map(row) : [];
 return {readers: Array.isArray(value.readers) && value.readers.length === 3 ? value.readers.map(input => {const reader = row(input); return {frames: number(reader.frames, 128), unavailable: number(reader.unavailable, 512)};}) : null,
  readFailures: number(value.readFailures, 512), lastState: member(value.lastState, ['queued', 'dispatching', 'active', 'finalizing', 'finished', 'errored', 'cancelled']),
  endpoints: ['settings', 'run', 'live'].map(endpoint => {const rows = calls.filter(call => call.endpoint === endpoint);
   const durations = rows.map(call => number(call.durationMs, 120000));
   return {endpoint, attempted: rows.length, successful: rows.filter(call => call.status === 200).length,
    unavailable: rows.filter(call => call.status === 429 || call.status === 503).length, other: rows.filter(call => ![200, 429, 503].includes(Number(call.status))).length,
    maximumMs: durations.length && durations.every(value => value !== null) ? Math.max(...durations as number[]) : null};}),
  sampleCounts: Array.isArray(value.series) && value.series.length === 3 ? value.series.map(series => Array.isArray(series) && series.length <= 128 ? series.length : null) : null};
}
/** Failure facts cannot satisfy a success predicate and contain no arbitrary strings. */
export function publicShortFailure(input: unknown, expectedRevision: string) {
 assert(/^[a-f0-9]{40}$/.test(expectedRevision)); const source = row(input); const results = row(source.results);
 return {format: 'beetle-short-control-observation', version: 1, scope: 'short-control-window', status: 'failed',
  sourceRevision: source.sourceRevision === expectedRevision ? expectedRevision : null,
  architecture: member(source.architecture, ['amd64', 'arm64']),
  harnessNode: typeof source.harnessNode === 'string' && /^v24\.[0-9]+\.[0-9]+$/.test(source.harnessNode) ? source.harnessNode : null,
  phase: member(source.phase, phases), rawStatus: member(source.status, ['failed', 'target-missed', 'passed']), cleanupVerified: source.cleanupVerified === true,
  diagnosis: diagnosis(results.failure), windows: ['idle', 'loaded', 'postIdle'].map(kind => ({kind, p95Ms: number(row(results[kind]).apiP95Ms, 120000), ...window(results[kind + 'Partial'])})),
  limits: ['Failed or incomplete observation; no qualification claim']};
}
