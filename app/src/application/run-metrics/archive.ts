import { encodeJson } from '@beetle/contracts';
import { runArtifactPageMatches, validateApi, RUN_ARTIFACT_PAGE_BYTES } from '@beetle/contracts/api';
import type { RunArtifactPage } from '@beetle/contracts/api';
import type { PublishedArtifactRead, RunArtifactsReader } from '../../ports/run-artifacts.js';
import type { RunMetricSeriesQuery } from '../../ports/run-metrics.js';
import type { OutputFileRecord } from '../../ports/output-bytes.js';
import { fields, fail, captureNumeric, knownVersion } from './values.js';
import type { NumericEvidence } from './values.js';
import type { ArchiveIO } from './io.js';
import type { ReadOwner } from './io.js';
type Artifact = RunArtifactPage['items'][number];
export interface ReadyArchive {
  page: RunArtifactPage; numeric: NumericEvidence; data: OutputFileRecord; index: OutputFileRecord;
  scope: {organizationId: string; workspaceId: string; attemptId: string; generation: 1};
  headerBytes: number; footerBytes: number;
}
export type Publication = {page: RunArtifactPage; reason: 'not_recorded' | 'unsupported_format' | null; archive: ReadyArchive | null};
async function catalogue(reader: RunArtifactsReader, q: RunMetricSeriesQuery, owner: ReadOwner): Promise<RunArtifactPage> {
  const firstQuery = {id: q.id, scope: q.scope, attemptId: q.attemptId, limit: 100};
  const first = capturePage(await reader.listRunArtifacts(firstQuery)); owner.check();
  if (!runArtifactPageMatches(first, firstQuery)) return fail();
  if (!first.nextCursor) return first;
  const secondQuery = {...firstQuery, limit: 28, cursor: first.nextCursor};
  const second = capturePage(await reader.listRunArtifacts(secondQuery)); owner.check();
  if (!runArtifactPageMatches(second, secondQuery) || second.nextCursor || first.manifestDigest !== second.manifestDigest) return fail();
  const items = [...first.items, ...second.items];
  if (items.length > 128 || new Set(items.map(a => a.artifactId)).size !== items.length) return fail();
  return {...first, items, nextCursor: null};
}
function matchesDescriptor(read: PublishedArtifactRead, expected: Artifact): boolean {
  const actual = read.record.artifact;
  return read.kind === expected.kind && actual.artifactId === expected.artifactId && actual.bytes === expected.bytes
    && actual.sha256 === expected.sha256 && actual.phase === 'published';
}
async function record(reader: RunArtifactsReader, q: RunMetricSeriesQuery, a: Artifact, owner: ReadOwner): Promise<OutputFileRecord> {
  const published = await reader.getRunArtifact({id: q.id, scope: q.scope, attemptId: q.attemptId, artifactId: a.artifactId}); owner.check();
  if (!matchesDescriptor(published, a)) return fail();
  const r = published.record; const b = r.binding.key; const s = b.attempt;
  if (b.runId !== q.id || s.attemptId !== q.attemptId || s.organizationId !== q.scope.organizationId
    || s.workspaceId !== q.scope.workspaceId || s.generation !== 1) return fail();
  return r;
}
export async function publication(reader: RunArtifactsReader, q: RunMetricSeriesQuery, io: ArchiveIO | undefined,
  owner: ReadOwner): Promise<Publication> {
  const page = await catalogue(reader, q, owner);
  if (page.availability !== 'ready') return {page, reason: null, archive: null};
  const select = (kind: string) => page.items.filter(a => a.kind === kind);
  const data = select('metric-windows'); const indexes = select('metric-index'); const finals = select('numeric-final');
  if (!data.length && !indexes.length) return {page, reason: 'not_recorded', archive: null};
  pairCounts([data.length, indexes.length, finals.length]);
  if (!io) return fail();
  const numericRecord = await record(reader, q, finals[0]!, owner);
  const scope = {organizationId: q.scope.organizationId, workspaceId: q.scope.workspaceId, attemptId: q.attemptId, generation: 1 as const};
  const numeric = captureNumeric(await io.json(numericRecord), scope);
  if (!numeric) return {page, reason: 'unsupported_format', archive: null};
  pairIdentity(numeric, data[0]!, indexes[0]!);
  const archive: ReadyArchive = {page, numeric, scope, data: await record(reader, q, data[0]!, owner),
    index: await record(reader, q, indexes[0]!, owner), headerBytes: 0, footerBytes: 0};
  if (!await probe(io, archive)) return {page, reason: 'unsupported_format', archive: null};
  return {page, reason: null, archive};
}
function header(value: unknown, lane: string, a: ReadyArchive): boolean {
  if (!knownVersion(value, 1)) return false;
  const v = fields(value, ['format', 'version', 'scope', 'dataArtifactId']);
  if (v.format !== lane || v.dataArtifactId !== a.numeric.dataArtifactId) return fail();
  const s = fields(v.scope, ['organizationId', 'workspaceId', 'attemptId', 'generation']);
  if (Object.keys(s).some(k => s[k] !== a.scope[k as keyof typeof a.scope])) return fail(); return true;
}
export function archiveHeader(value: unknown, lane: string, a: ReadyArchive): void {
  if (!header(value, lane, a)) return fail();
}
async function edge(io: ArchiveIO, r: OutputFileRecord, first: boolean, max: number): Promise<{value: unknown; length: number}> {
  const size = Math.min(r.artifact.bytes, max); const bytes = new Uint8Array(size); let offset = 0;
  await io.range(r, first ? 0 : r.artifact.bytes - size, first ? size : r.artifact.bytes, async b => {bytes.set(b, offset); offset += b.length;});
  let start = 0; let end = bytes.indexOf(10);
  if (!first) { if (bytes[size - 1] !== 10) return fail(); end = size - 1; start = bytes.lastIndexOf(10, end - 1) + 1; }
  if (end < start) return fail();
  try { return {value: JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(bytes.subarray(start, end))), length: end - start + 1}; }
  catch { return fail(); }
}
async function probe(io: ArchiveIO, a: ReadyArchive): Promise<boolean> {
  const dataHeader = await edge(io, a.data, true, 1024); const indexHeader = await edge(io, a.index, true, 1024);
  if (!header(dataHeader.value, 'beetle-k6-metric-windows', a) || !header(indexHeader.value, 'beetle-k6-metric-index', a)) return false;
  const dataFooter = await edge(io, a.data, false, 256); const indexFooter = await edge(io, a.index, false, 256);
  const d = fields(dataFooter.value, ['kind', 'windows']);
  if (d.kind !== 'end' || d.windows !== a.numeric.windows) return fail();
  indexEnd(indexFooter.value, a); a.headerBytes = dataHeader.length; a.footerBytes = dataFooter.length; return true;
}
export function indexEnd(value: unknown, a: ReadyArchive): void {
  const v = fields(value, ['kind', 'windows', 'dataBytes', 'dataSha256']);
  if (v.kind !== 'end' || v.windows !== a.numeric.windows || v.dataBytes !== a.data.artifact.bytes
    || v.dataSha256 !== a.data.artifact.sha256) return fail();
}
function pairCounts(counts: number[]): void { if (counts.some(n => n !== 1)) return fail(); }
function pairIdentity(numeric: NumericEvidence, data: Artifact, index: Artifact): void {
  if (numeric.dataArtifactId !== data.artifactId || numeric.indexArtifactId !== index.artifactId
    || numeric.bytes !== data.bytes + index.bytes || index.bytes > 1024 + 65536 * 256 + 256) return fail();
}
function capturePage(input: unknown): RunArtifactPage {
  let snapshot: unknown;
  try {snapshot = JSON.parse(encodeJson(input, RUN_ARTIFACT_PAGE_BYTES)) as unknown;} catch {return fail();}
  const checked = validateApi('RunArtifactPage', snapshot); if (!checked.ok) return fail(); return checked.value;
}
