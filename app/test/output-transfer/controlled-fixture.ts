import { executionArtifacts } from '@beetle/contracts';
import { vi } from 'vitest';
import { createHash } from 'node:crypto';
import { sealEngineResult } from '@beetle/contracts';
import { prepareOutputManifest } from '@beetle/contracts/output-source';
import type { ClientResult } from '@beetle/contracts';
import type { Owned, SourceChunk, SourceEnvelope } from '@beetle/contracts/output-source';
import type { OutputArtifactState, OutputCustodyState } from '../../src/ports/output-custody.js';
import type { OutputArtifactClaim, OutputArtifactProgress } from '../../src/ports/output-artifacts.js';
import type { OutputFileJob, OutputFileReceipt, OutputFileRecord } from '../../src/ports/output-bytes.js';
import type { OutputTransferOptions } from '../../src/ports/output-transfer.js';
import type { RunnerOutputClient } from '../../src/ports/output-source.js';
import { createOutputTransfers } from '../../src/application/output-transfer/index.js';
import { envelope as vector } from '../runner/source-fixtures.js';
export { deferred, turns } from '../runner/fixtures.js';
export { pending } from '../files/output-bytes/fixture.js';
export const id = (value: number) => `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
export function fileJob<T>(value: T): OutputFileJob<T> {return {result: Promise.resolve(value), settled: Promise.resolve()};}
function singleSource(): SourceEnvelope {
  const source = vector(); if ('purpose' in source.manifest.result) throw new Error('Expected performance fixture');
  const {seal, ...body} = source.manifest.result;
  const hash = (text: string) => createHash('sha256').update(text).digest('hex');
  const result = sealEngineResult({...body, artifacts: body.artifacts.slice(0, 1)}, seal.sealedAt, hash);
  if (!result.ok) throw new Error('Invalid synthetic source');
  const {manifestDigest, ...manifest} = source.manifest; void manifestDigest;
  const prepared = prepareOutputManifest({...manifest, result: result.value}, hash);
  return JSON.parse(JSON.stringify({...source, manifest: prepared, closure: {...source.closure,
    receipt: {...source.closure.receipt, manifestDigest: prepared.manifestDigest}}})) as SourceEnvelope;
}
export function fixture() {
  const source = singleSource(); const remote = source.manifest.binding;
  const binding = {key: {runId: id(900), attempt: {organizationId: remote.organizationId, workspaceId: remote.workspaceId,
    attemptId: remote.attemptId, generation: 1 as const, intentDigest: remote.intentDigest}}, journalAuthority: remote.journalAuthority};
  let retained: OutputCustodyState = {kind: 'pending', binding};
  const receipt = (record: OutputFileRecord, published = false): OutputFileReceipt => ({token: record.artifact.token,
    offset: published ? record.artifact.bytes : record.artifact.offset, phase: published ? 'published' : 'transferring',
    identity: published ? 'e'.repeat(64) : 'd'.repeat(64)});
  function adopted(): Extract<OutputCustodyState, {kind: 'adopted'}> {
    return {kind: 'adopted', binding, version: 1, manifestDigest: source.manifest.manifestDigest, sourceDigest: source.sourceDigest,
      finalAgentSeq: source.closure.finalAgentSeq, artifacts: executionArtifacts(source.manifest.result).map((a, ordinal) => ({ordinal,
        artifactId: a.artifactId, token: id(100 + ordinal), bytes: a.bytes, sha256: a.sha256,
        offset: 0, phase: 'transferring', identity: null, writer: null, version: 1}))};
  }
  function update(request: OutputArtifactClaim, patch: Partial<OutputArtifactState>): OutputFileRecord {
    if (retained.kind !== 'adopted') throw new Error('No source');
    const old = retained.artifacts[request.key.ordinal]!;
    const artifact = {...old, ...patch, version: old.version + 1};
    retained = {...retained, artifacts: retained.artifacts.map((a, index) => index === request.key.ordinal ? artifact : a)};
    return {binding, artifact};
  }
  const metadata = {
    load: vi.fn(async () => retained), readSource: vi.fn(async (): Promise<Owned<SourceEnvelope> | null> => source),
    adopt: vi.fn(async () => { retained = adopted(); return retained; }),
    claimArtifact: vi.fn(async (r: OutputArtifactClaim) => update(r, {writer: r.writerId})),
    recordProgress: vi.fn(async (r: OutputArtifactProgress) => update(r, {offset: r.receipt.offset, identity: r.receipt.identity})),
    beginPublication: vi.fn(async (r: OutputArtifactClaim) => update(r, {phase: 'publishing'})),
    recordPublication: vi.fn(async (r: OutputArtifactProgress) => update(r, {phase: 'published', writer: null, identity: r.receipt.identity})),
    close: vi.fn(),
  };
  const output = {source: vi.fn(async (): Promise<ClientResult<Owned<SourceEnvelope>>> => ({ok: true, value: source})),
    sourceChunk: vi.fn(async (request: Parameters<RunnerOutputClient['sourceChunk']>[0], total: number): Promise<ClientResult<Owned<SourceChunk>>> => {
      const bytes = Buffer.alloc(Math.min(request.length, total - request.offset), 7);
      return {ok: true, value: {version: 1, manifestDigest: request.manifestDigest, sourceDigest: request.sourceDigest,
        artifactId: request.artifactId, offset: request.offset, nextOffset: request.offset + bytes.length,
        eof: request.offset + bytes.length === total, totalBytes: total, base64: bytes.toString('base64')}};
    })};
  const gateway = {output: vi.fn(() => output), close: vi.fn(), attempt: vi.fn(), capabilities: vi.fn()};
  const files = {
    prepare: vi.fn((r: OutputFileRecord) => fileJob(receipt(r, r.artifact.phase === 'published'))),
    append: vi.fn((r: {record: OutputFileRecord; offset: number; bytes: Uint8Array}) => fileJob({...receipt(r.record), offset: r.offset + r.bytes.length})),
    publish: vi.fn((r: OutputFileRecord) => fileJob(receipt(r, true))), close: vi.fn(),
  };
  const options: OutputTransferOptions = {metadata, gateway, files, freeSpaceReserveBytes: 0, newWriterId: vi.fn(() => id(800))};
  return {source, binding, metadata, gateway, output, files, options, adopted,
    get state() {return retained;}, set state(value: OutputCustodyState) {retained = value;}, create: () => createOutputTransfers(options)};
}
