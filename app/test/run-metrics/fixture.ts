import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { validateApi } from '@beetle/contracts/api';
import type { Artifact } from '@beetle/contracts';
import type { RunArtifactsReader } from '../../src/ports/run-artifacts.js';
import type { OutputByteStore } from '../../src/ports/output-bytes.js';
import { createRunMetricsService } from '../../src/application/run-metrics/index.js';
export const digest = () => {const hash = createHash('sha256'); return {update(bytes: Uint8Array) {hash.update(bytes);}, hex: () => hash.digest('hex')};};
export const context = () => ({signal: new AbortController().signal, deadline: performance.now() + 10000});
export async function fixture() {
  const raw = JSON.parse(await readFile(new URL('./wrapper-three-windows.json', import.meta.url), 'utf8')) as {
    scope: {organizationId: string; workspaceId: string; attemptId: string; generation: 1}; artifacts: {descriptor: Artifact; utf8: string}[]};
  const id = '00000000-0000-4000-8000-000000000070';
  const scope = {kind: 'workspace' as const, organizationId: raw.scope.organizationId, workspaceId: raw.scope.workspaceId};
  const query = {id, scope, attemptId: raw.scope.attemptId, limit: 100};
  const contents = new Map(raw.artifacts.map(a => [a.descriptor.artifactId, Buffer.from(a.utf8)]));
  const descriptors = raw.artifacts.map(a => ({...a.descriptor}));
  const records = new Map(descriptors.map((a, ordinal) => [a.artifactId, {binding: {key: {runId: id, attempt: {...raw.scope, intentDigest: 'a'.repeat(64)}},
    journalAuthority: '00000000-0000-4000-8000-000000000009'}, artifact: {ordinal, artifactId: a.artifactId,
    token: '00000000-0000-4000-8000-000000000010', bytes: a.bytes, sha256: a.sha256, offset: a.bytes, phase: 'published' as const,
    identity: 'd'.repeat(64), writer: null, version: 1}}]));
  const reader: RunArtifactsReader = {
    async listRunArtifacts(q) {
      return {id: q.id, scope: q.scope, attemptId: q.attemptId, generation: 1, availability: 'ready', manifestDigest: 'c'.repeat(64), items: descriptors, nextCursor: null};
    }, async getRunArtifact(key) {const record = records.get(key.artifactId); const descriptor = descriptors.find(a => a.artifactId === key.artifactId);
      if (!record || !descriptor) throw new Error('No artifact'); return {record, kind: descriptor.kind};},
  };
  const chunkSize = {bytes: 37};
  const reads: {id: string; start: number; end: number}[] = [];
  const bytes: Pick<OutputByteStore, 'read'> = {read(request, c) {
    const original = Promise.resolve().then(async () => {
      reads.push({id: request.record.artifact.artifactId, start: request.start, end: request.endExclusive});
      const value = contents.get(request.record.artifact.artifactId)!;
      for (let offset = request.start; offset < request.endExclusive; offset += chunkSize.bytes) {
        if (c.signal?.aborted) throw new Error('Cancelled');
        await request.sink.write(value.subarray(offset, Math.min(offset + chunkSize.bytes, request.endExclusive)));
      }
    });
    return {result: original, settled: original.then(() => undefined, () => undefined)};
  }};
  return {raw, descriptors, contents, records, reader, bytes, reads, query, chunkSize,
    service: () => createRunMetricsService({artifacts: reader, bytes, createDigest: digest})};
}
export function checkedPage(value: unknown) {
  const result = validateApi('RunMetricSamplesPage', value); if (!result.ok) throw new Error('Invalid sample page'); return result.value;
}
export function rewrite(f: Awaited<ReturnType<typeof fixture>>, kind: string, change: (text: string) => string, updateHash = true) {
  const a = f.descriptors.find(a => a.kind === kind)!; const text = change(f.contents.get(a.artifactId)!.toString('utf8'));
  const bytes = Buffer.from(text); f.contents.set(a.artifactId, bytes); a.bytes = bytes.length;
  if (updateHash) a.sha256 = createHash('sha256').update(bytes).digest('hex');
  const r = f.records.get(a.artifactId)!;
  f.records.set(a.artifactId, {...r, artifact: {...r.artifact, bytes: a.bytes, sha256: a.sha256}});
}
/** Keep independent publication facts consistent so corrupt row/frame tests reach the decoder. */
export function rebindPair(f: Awaited<ReturnType<typeof fixture>>): void {
  const data = f.descriptors.find(a => a.kind === 'metric-windows')!;
  rewrite(f, 'metric-index', text => text.split('\n').map(line => {
    if (!line) return line; const row = JSON.parse(line) as {kind?: string; dataBytes?: number; dataSha256?: string};
    if (row.kind === 'end') {row.dataBytes = data.bytes; row.dataSha256 = data.sha256;} return JSON.stringify(row);
  }).join('\n'));
  rewrite(f, 'numeric-final', text => {const value = JSON.parse(text) as {history: {bytes: number}};
    value.history.bytes = f.descriptors.filter(a => a.kind === 'metric-windows' || a.kind === 'metric-index').reduce((n, a) => n + a.bytes, 0);
    return JSON.stringify(value);});
}
