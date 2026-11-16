import { gateFor } from '../producer-gate/fixtures.js';
import { executionArtifacts } from '@beetle/contracts';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { lstat, readFile } from 'node:fs/promises';
import { expect, it, vi } from 'vitest';
import { encodeJson } from '@beetle/contracts';
import { verifySourceChunk, verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { Owned, SourceChunkRequest, SourceEnvelope } from '@beetle/contracts/output-source';
import { readOutputRange } from '../../src/collection/output/index.js';
import { createOutputSourceReader } from '../../src/output-transfer/index.js';
import { CONTROL_FILE } from '../../src/control-protocol/index.js';
import { sourceFixture } from './source-fixture.js';

const f = sourceFixture();
const operation = () => ({ deadline: performance.now() + 5000 });
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
function selector(envelope: Owned<SourceEnvelope>, artifactId: string, offset = 0): SourceChunkRequest {
  return { version: 1, manifestDigest: envelope.manifest.manifestDigest, sourceDigest: envelope.sourceDigest,
    artifactId, offset, length: 65_536 };
}

it('composes actual collector, compiled Journal, native ranges and source service for binary/empty artifacts', async () => {
  const e = await f.prepare(); const envelope = await e.reader.source(e.key, operation());
  expect(verifySourceEnvelope(envelope, text => digest(text))).toEqual(envelope);
  expect(envelope).toEqual({ version: 1, manifest: (await e.journal.readOutputSource(e.key))!.manifest,
    sourceDigest: e.receipt.sourceDigest, closure: e.closure });
  expect(envelope.manifest.binding).toEqual(e.intent.binding); expect(e.released).toMatchObject({ status: 'released', releaseEvidence: { collection: { state: 'finished' } } });
  const events = await e.journal.readEvents(e.key, 0);
  expect(events.events.map(event => ({ seq: event.seq, kind: event.kind, source: event.source }))).toEqual([
    { seq: 1, kind: 'admitted', source: 'agent' }, { seq: 2, kind: 'engine.result', source: 'wrapper' }]);
  expect(events.events[1]).toMatchObject({ wrapperSeq: 1, payload: e.result });
  expect(events.nextCursor).toBe(2); expect(envelope.closure).toMatchObject({ receipt: e.receipt, finalAgentSeq: 2 });
  expect(Object.isFrozen(executionArtifacts(envelope.manifest.result))).toBe(true);
  const text = encodeJson(envelope, 75_776);
  for (const field of ['root', 'directory', 'checkpoint', 'release', 'createToken', 'runtimeId', 'modifiedNs', 'changedNs']) expect(text).not.toContain(`"${field}"`);
  expect(text).not.toContain(e.files.directory()); expect(text).not.toContain(e.path);
  const root = await lstat(e.files.directory(), { bigint: true }); const resultBytes = await readFile(e.files.path());
  const controlBytes = await readFile(e.files.path(CONTROL_FILE)); expect(controlBytes).toEqual(e.control);
  expect(e.intent.checkpoint).toMatchObject({ offset: controlBytes.length, prefixSha256: digest(controlBytes),
    dev: e.controlStat.dev.toString(), ino: e.controlStat.ino.toString() });
  expect(e.collection.custody).toEqual({ resultFileBytes: resultBytes.length, controlBytes: controlBytes.length,
    root: { directory: e.files.directory(), uid: Number(root.uid), device: root.dev.toString(), inode: root.ino.toString(),
      modifiedNs: root.mtimeNs.toString(), changedNs: root.ctimeNs.toString() } });
  expect(JSON.parse(resultBytes.toString('utf8'))).toEqual(e.result);
  expect(e.collection.verifiedBytes).toBe(resultBytes.length + controlBytes.length + e.bytes.length);
  const payloads: Buffer[] = []; const lengths: number[] = [];
  const artifact = executionArtifacts(envelope.manifest.result)[0]!;
  for (let offset = 0; offset < artifact.bytes;) {
    const request = selector(envelope, artifact.artifactId, offset); const reply = await e.reader.chunk(e.key, request, operation());
    expect(verifySourceChunk(reply, request, artifact.bytes)).toEqual(reply); expect(encodeJson(reply, 90_112)).toBeTruthy();
    const bytes = Buffer.from(reply.base64, 'base64'); payloads.push(bytes); lengths.push(bytes.length);
    expect(bytes).toEqual(e.bytes.subarray(offset, reply.nextOffset)); expect(reply.eof).toBe(reply.nextOffset === artifact.bytes);
    offset = reply.nextOffset;
  }
  expect(lengths).toEqual([65_536, 65_536, 17]); const combined = Buffer.concat(payloads);
  expect(combined).toEqual(e.bytes); expect(combined).toEqual(await readFile(e.files.path(artifact.relativePath)));
  expect(digest(combined)).toBe(digest(e.bytes)); expect(digest(combined)).toBe(artifact.sha256);
  const end = await e.reader.chunk(e.key, selector(envelope, artifact.artifactId, artifact.bytes), operation());
  expect(end).toMatchObject({ base64: '', nextOffset: artifact.bytes, totalBytes: artifact.bytes, eof: true });
  const empty = executionArtifacts(envelope.manifest.result)[1]!; expect(empty.bytes).toBe(0);
  expect(await e.reader.chunk(e.key, selector(envelope, empty.artifactId), operation())).toMatchObject({ base64: '', nextOffset: 0, totalBytes: 0, eof: true });
  expect(digest(await readFile(e.files.path(empty.relativePath)))).toBe(empty.sha256);
  expect(await e.journal.readOutputDelivery(e.key)).toEqual(e.closure);
});

it('reopens the same physical source/closure and refuses stale selectors before actual range IO', async () => {
  const e = await f.prepare(); const before = await e.reader.source(e.key, operation());
  const stored = await e.journal.readOutputSource(e.key); await f.close(e.journal);
  const journal = await f.open(e.path); const native = vi.fn(readOutputRange);
  const reader = createOutputSourceReader({ journal, gate: gateFor(journal), readRange: native }); const envelope = await reader.source(e.key, operation());
  expect(envelope).toEqual(before); expect(await journal.journalAuthority()).toBe(before.manifest.binding.journalAuthority);
  expect(await journal.readOutputCollection(e.key)).toEqual(e.intent); expect(await journal.readOutputDelivery(e.key)).toEqual(e.closure);
  const request = selector(envelope, executionArtifacts(envelope.manifest.result)[0]!.artifactId);
  for (const field of ['manifestDigest', 'sourceDigest', 'artifactId'] as const) {
    const stale = { ...request, [field]: field === 'artifactId' ? 'ffffffff-ffff-4fff-8fff-ffffffffffff' : 'f'.repeat(64) };
    await expect(reader.chunk(e.key, stale, operation())).rejects.toMatchObject({ code: 'conflict' });
  }
  expect(native).not.toHaveBeenCalled();
  const reply = await reader.chunk(e.key, request, operation()); expect(native).toHaveBeenCalledTimes(1);
  expect(Buffer.from(reply.base64, 'base64')).toEqual(e.bytes.subarray(0, 65_536));
  expect(native.mock.calls[0]![0]).toMatchObject({ root: e.collection.custody.root, artifact: e.artifacts[0] });
  expect(await journal.readOutputSource(e.key)).toEqual(stored);
});
