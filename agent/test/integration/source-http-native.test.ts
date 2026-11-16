import { executionArtifacts } from '@beetle/contracts';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { createHttpTransport, createRunnerClient, encodeJson } from '@beetle/contracts';
import { verifySourceChunk, verifySourceEnvelope } from '@beetle/contracts/output-source';
import type { SourceChunkRequest, SourceEnvelope } from '@beetle/contracts/output-source';
import { createAgentServer } from '../../src/transport/index.js';
import { sourceFixture } from './source-fixture.js';

const f = sourceFixture();
const digest = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const unused = async (): Promise<never> => { throw new Error('Unexpected control/capability call'); };
type Client = ReturnType<typeof createRunnerClient>;
type Evidence = Awaited<ReturnType<typeof f.prepare>>;
function selector(envelope: SourceEnvelope, artifactId: string, offset = 0): SourceChunkRequest {
  return { version: 1, manifestDigest: envelope.manifest.manifestDigest, sourceDigest: envelope.sourceDigest,
    artifactId, offset, length: 65_536 };
}
async function chunk(client: Client, attemptId: string, request: SourceChunkRequest, artifactBytes: number) {
  const response = await client.sourceChunk(attemptId, request);
  expect(response.ok).toBe(true);
  if (!response.ok) throw new Error(`Source chunk failed: ${JSON.stringify(response.error)}`);
  expect(verifySourceChunk(response.value, request, artifactBytes)).toEqual(response.value);
  expect(encodeJson(response.value, 90_112)).toBeTruthy();
  return response.value;
}
async function transfer(client: Client, e: Evidence, envelope: SourceEnvelope) {
  const artifact = executionArtifacts(envelope.manifest.result)[0]!;
  expect(artifact.bytes).toBe(131_089);
  const payloads: Buffer[] = []; const lengths: number[] = [];
  for (let offset = 0; offset < artifact.bytes;) {
    const reply = await chunk(client, e.key.attemptId, selector(envelope, artifact.artifactId, offset), artifact.bytes);
    const bytes = Buffer.from(reply.base64, 'base64'); payloads.push(bytes); lengths.push(bytes.length);
    expect(bytes).toEqual(e.bytes.subarray(offset, reply.nextOffset));
    expect(reply.eof).toBe(reply.nextOffset === artifact.bytes); offset = reply.nextOffset;
  }
  expect(lengths).toEqual([65_536, 65_536, 17]);
  const combined = Buffer.concat(payloads);
  expect(combined).toEqual(e.bytes);
  expect(combined).toEqual(await readFile(e.files.path(artifact.relativePath)));
  expect(digest(combined)).toBe(digest(e.bytes)); expect(digest(combined)).toBe(artifact.sha256);
  const end = await chunk(client, e.key.attemptId, selector(envelope, artifact.artifactId, artifact.bytes), artifact.bytes);
  expect(end).toMatchObject({ base64: '', nextOffset: artifact.bytes, totalBytes: artifact.bytes, eof: true });
  const empty = executionArtifacts(envelope.manifest.result)[1]!; expect(empty.bytes).toBe(0);
  const zero = await chunk(client, e.key.attemptId, selector(envelope, empty.artifactId), empty.bytes);
  expect(zero).toMatchObject({ base64: '', nextOffset: 0, totalBytes: 0, eof: true });
  expect(digest(Buffer.from(zero.base64, 'base64'))).toBe(empty.sha256);
  expect(await readFile(e.files.path(empty.relativePath))).toEqual(Buffer.alloc(0));
}

it('serves actual Journal/native source bytes and closure over authenticated loopback HTTP', async () => {
  const e = await f.prepare(); const journalAuthority = await e.journal.journalAuthority();
  const server = createAgentServer({ credential: 'S'.repeat(64), journalAuthority, journal: e.journal, outputs: e.reader,
    installation: { cancelExportOriginal: unused, enqueueExport: unused, enqueue: unused, cancel: unused, cancelOriginal: unused }, capabilities: unused });
  try {
    const baseUrl = await server.listen({ host: '127.0.0.1', port: 0 });
    const client = createRunnerClient(createHttpTransport({ baseUrl, maximumBytes: 90_112, timeoutMs: 5000, headers: {
      authorization: `Bearer ${'S'.repeat(64)}`, 'x-beetle-organization-id': e.key.organizationId,
      'x-beetle-workspace-id': e.key.workspaceId, 'x-beetle-generation': '1', 'x-beetle-journal-authority': journalAuthority,
    } }));
    const response = await client.source(e.key.attemptId);
    expect(response.ok).toBe(true);
    if (!response.ok) throw new Error(`Source request failed: ${JSON.stringify(response.error)}`);
    const envelope = response.value;
    expect(verifySourceEnvelope(envelope, digest)).toEqual(envelope);
    expect(envelope).toEqual({ version: 1, manifest: (await e.journal.readOutputSource(e.key))!.manifest,
      sourceDigest: e.receipt.sourceDigest, closure: e.closure });
    expect(envelope.manifest.binding).toEqual(e.intent.binding);
    expect(envelope.closure).toMatchObject({ receipt: e.receipt, finalAgentSeq: 2 });
    const text = encodeJson(envelope, 75_776);
    for (const field of ['root', 'directory', 'checkpoint', 'release', 'createToken', 'runtimeId', 'modifiedNs', 'changedNs']) {
      expect(text).not.toContain(`"${field}"`);
    }
    expect(text).not.toContain(e.files.directory()); expect(text).not.toContain(e.path);
    await transfer(client, e, envelope);
    expect(await e.journal.readOutputDelivery(e.key)).toEqual(e.closure);
  } finally {
    // Source calls settle native originals; server close drains request/socket owners before fixture cleanup.
    await server.close();
  }
});
