import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { encodeCanonicalJson, validate } from '../src/index.js';
import { captureSourceChunkRequest, verifySourceChunk, verifySourceEnvelope,
  OUTPUT_MANIFEST_PREFIX, SOURCE_CHUNK_BYTES, SOURCE_ENVELOPE_BYTES } from '../src/output-source/index.js';
import type { SourceChunk, SourceChunkRequest, SourceEnvelope } from '../src/output-source/index.js';
import data from '../fixtures/output-source/v1.json' with { type: 'json' };

const digest = (text: string) => createHash('sha256').update(text).digest('hex');
function envelope(): SourceEnvelope {
  const vector = data.vectors[0]!;
  const manifest = { ...JSON.parse(vector.expected.manifestPreimage.slice(OUTPUT_MANIFEST_PREFIX.length)),
    manifestDigest: vector.expected.manifestDigest } as SourceEnvelope['manifest'];
  const { organizationId, workspaceId, attemptId, generation, journalAuthority } = manifest.binding;
  const sourceDigest = digest('synthetic opaque private source identity');
  return { version: 1, manifest, sourceDigest, closure: { version: 1, finalAgentSeq: 37,
    receipt: { version: 1, journalAuthority, key: { organizationId, workspaceId, attemptId, generation },
      manifestDigest: manifest.manifestDigest, sourceDigest } } };
}
function request(offset = 0, length = 65_536): SourceChunkRequest {
  return { version: 1, manifestDigest: 'a'.repeat(64), sourceDigest: 'b'.repeat(64),
    artifactId: '00000000-0000-4000-8000-000000000001', offset, length };
}
function chunk(bytes: Buffer, expected = request(), total = expected.offset + bytes.length): SourceChunk {
  const { length, ...selector } = expected; void length;
  return { ...selector, nextOffset: expected.offset + bytes.length, totalBytes: total,
    eof: expected.offset + bytes.length === total, base64: bytes.toString('base64') };
}

it('verifies shared golden manifest and exact closure receipt without private source facts', () => {
  const input = envelope();
  expect(validate('SourceEnvelope', input).ok).toBe(true);
  const owned = verifySourceEnvelope(input, digest);
  expect(owned).toEqual(input); expect(owned).not.toBe(input);
  expect(Object.isFrozen(owned.manifest.result)).toBe(true);
  expect(Object.isFrozen(owned.closure.receipt.key)).toBe(true);
  input.closure.finalAgentSeq++;
  expect(owned.closure.finalAgentSeq).toBe(37);
  expect(Buffer.byteLength(encodeCanonicalJson(owned, SOURCE_ENVELOPE_BYTES))).toBeLessThan(SOURCE_ENVELOPE_BYTES);
});
it.each(['authority', 'scope', 'manifest', 'source', 'sequence', 'privateField', 'seal'])(
  'refuses an invalid envelope %s relationship', field => {
    const input = envelope();
    if (field === 'authority') input.closure.receipt.journalAuthority = input.manifest.binding.attemptId;
    if (field === 'scope') input.closure.receipt.key.workspaceId = input.manifest.binding.attemptId;
    if (field === 'manifest') input.closure.receipt.manifestDigest = 'c'.repeat(64);
    if (field === 'source') input.closure.receipt.sourceDigest = 'c'.repeat(64);
    if (field === 'sequence') input.closure.finalAgentSeq = Number.MAX_SAFE_INTEGER + 1;
    if (field === 'privateField') Reflect.set(input, 'root', '/synthetic/private/root');
    if (field === 'seal') input.manifest.result.seal.sha256 = 'c'.repeat(64);
    expect(() => verifySourceEnvelope(input, digest)).toThrow();
  });
it('rejects foreign accessors and oversized envelope carriers before foreign hashing', () => {
  const get = vi.fn(); const hash = vi.fn(digest);
  const input = envelope(); Object.defineProperty(input, 'sourceDigest', { get, enumerable: true });
  expect(() => verifySourceEnvelope(input, hash)).toThrow(); expect(get).not.toHaveBeenCalled();
  expect(() => verifySourceEnvelope({ ...envelope(), sourceDigest: 'x'.repeat(SOURCE_ENVELOPE_BYTES + 1) }, hash)).toThrow();
  expect(hash).not.toHaveBeenCalled();
});
it.each([0, 1, 2, 3, 65_535, 65_536])('accepts exact canonical binary range of %i bytes', length => {
  const bytes = Buffer.alloc(length); for (let index = 0; index < length; index++) bytes[index] = index % 256;
  const input = chunk(bytes); const owned = verifySourceChunk(input, request(), length);
  expect(Buffer.from(owned.base64, 'base64')).toEqual(bytes); expect(Object.isFrozen(owned)).toBe(true);
  expect(Buffer.byteLength(encodeCanonicalJson(owned, SOURCE_CHUNK_BYTES))).toBeLessThan(SOURCE_CHUNK_BYTES);
});
it('accepts explicit EOF at a nonzero exact end and the safe-integer boundary', () => {
  for (const offset of [19, Number.MAX_SAFE_INTEGER]) {
    const expected = request(offset);
    expect(verifySourceChunk(chunk(Buffer.alloc(0), expected), expected, offset)).toMatchObject({ eof: true, nextOffset: offset });
  }
  const expected = request(Number.MAX_SAFE_INTEGER - 1, 65_536);
  expect(verifySourceChunk(chunk(Buffer.from([1]), expected), expected, Number.MAX_SAFE_INTEGER).nextOffset).toBe(Number.MAX_SAFE_INTEGER);
});
it('requires exact requested length before EOF and explicit final shortening', () => {
  const expected = request(5, 3); const input = chunk(Buffer.from([1, 2, 3]), expected, 10);
  expect(verifySourceChunk(input, expected, 10).eof).toBe(false);
  expect(() => verifySourceChunk(chunk(Buffer.from([1, 2]), expected, 10), expected, 10)).toThrow();
  expect(verifySourceChunk(chunk(Buffer.from([1, 2]), expected, 7), expected, 7).eof).toBe(true);
});
it.each(['QV==', 'QUL=', '=AAA', 'A===', 'AAA', 'AA\n=', 'AA-_', '===='])(
  'rejects noncanonical base64 %s before decode', base64 => {
    const bytes = base64.length === 4 && base64.endsWith('=') && !base64.endsWith('==') ? 2 : 1;
    const input = { ...chunk(Buffer.alloc(bytes)), base64 };
    expect(() => verifySourceChunk(input, request(), bytes)).toThrow();
  });
it.each(['manifestDigest', 'sourceDigest', 'artifactId', 'offset', 'nextOffset', 'totalBytes', 'eof'])(
  'rejects mismatched chunk %s', field => {
    const input = chunk(Buffer.from([1]));
    const changes = { manifestDigest: 'c'.repeat(64), sourceDigest: 'c'.repeat(64),
      artifactId: '00000000-0000-4000-8000-000000000002', offset: 1, nextOffset: 0, totalBytes: 2, eof: false };
    Reflect.set(input, field, changes[field as keyof typeof changes]);
    expect(() => verifySourceChunk(input, request(), 1)).toThrow();
  });
it.each([{ length: 0 }, { length: 65_537 }, { offset: -1 }, { offset: Number.MAX_SAFE_INTEGER + 1 },
  { version: 2 }, { path: 'undeclared' }, { sourceDigest: 'X'.repeat(64) }])('rejects invalid source selector %j', change => {
  expect(() => captureSourceChunkRequest({ ...request(), ...change })).toThrow();
});
it('refuses oversized encoded bytes and requests beyond the declared end', () => {
  expect(() => verifySourceChunk(chunk(Buffer.alloc(65_537)), request(), 65_537)).toThrow();
  expect(() => verifySourceChunk(chunk(Buffer.alloc(0), request(1)), request(1), 0)).toThrow();
  const input = request(); const owned = captureSourceChunkRequest(input); input.offset = 3;
  expect(owned.offset).toBe(0); expect(Object.isFrozen(owned)).toBe(true);
});
it.each(['source_pending', 'source_unavailable'])('accepts scoped %s without inventing success', reason => {
  const original = envelope().manifest.binding;
  expect(validate('ProtocolError', { protocolVersion: '1.0', organizationId: original.organizationId,
    workspaceId: original.workspaceId, attemptId: original.attemptId, reason,
    retry: reason === 'source_pending' ? 'transport' : 'never', issues: [] }).ok).toBe(true);
});
