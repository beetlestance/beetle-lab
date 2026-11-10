import { expect, it, vi } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { OUTPUT_MANIFEST_PREFIX, OUTPUT_SOURCE_PREFIX, prepareOutputSource, verifyOutputSource,
  receiptForOutputSource, OutputSourceError } from '../../src/output-source/index.js';
import { assertFrozen, digest, input, rehash, reseal, source, vectors } from './fixtures.js';

it.each(vectors)('matches independent $name preimages, digests, byte counts and immutable receipt', vector => {
  const preimages: string[] = [];
  const prepared = prepareOutputSource(vector.input, text => { preimages.push(text); return digest(text); });
  expect(preimages.filter(text => text.startsWith(OUTPUT_MANIFEST_PREFIX))).toEqual([vector.expected.manifestPreimage]);
  expect(preimages.filter(text => text.startsWith(OUTPUT_SOURCE_PREFIX))).toEqual([vector.expected.sourcePreimage]);
  expect(prepared.manifest.manifestDigest).toBe(vector.expected.manifestDigest);
  expect(prepared.sourceDigest).toBe(vector.expected.sourceDigest);
  expect(Buffer.byteLength(encodeCanonicalJson(prepared.manifest, 73_728))).toBe(vector.expected.manifestBytes);
  expect(Buffer.byteLength(encodeCanonicalJson(prepared, 131_072))).toBe(vector.expected.sourceBytes);
  expect(verifyOutputSource(prepared, digest)).toEqual(prepared);
  const { binding } = prepared.manifest;
  const receipt = receiptForOutputSource(prepared, digest);
  expect(receipt).toEqual({ version: 1, journalAuthority: binding.journalAuthority,
    key: { attemptId: binding.attemptId, organizationId: binding.organizationId, workspaceId: binding.workspaceId, generation: 1 },
    manifestDigest: prepared.manifest.manifestDigest, sourceDigest: prepared.sourceDigest });
  expect(assertFrozen(prepared) && assertFrozen(receipt)).toBe(true);
});
it('distinguishes public content from private custody, raw whitespace and array ordering', () => {
  const values = vectors.map(vector => prepareOutputSource(vector.input, digest));
  expect(values[1]).toEqual(values[0]);
  expect(values[2]!.manifest.manifestDigest).toBe(values[0]!.manifest.manifestDigest);
  for (const index of [2, 3, 4]) expect(values[index]!.sourceDigest).not.toBe(values[0]!.sourceDigest);
  for (const index of [3, 4]) expect(values[index]!.manifest.manifestDigest).not.toBe(values[0]!.manifest.manifestDigest);
  expect(values[0]!.manifest.result.artifacts[1]!.bytes).toBe(0);
});
it.each(['result', 'manifest', 'source'] as const)('classifies validly shaped %s hash mismatches as integrity', kind => {
  const value = source();
  if (kind === 'result') { value.manifest.result.seal.sha256 = '0'.repeat(64); rehash(value); }
  if (kind === 'manifest') { value.manifest.manifestDigest = '0'.repeat(64); }
  if (kind === 'source') value.sourceDigest = '0'.repeat(64);
  for (const codec of [verifyOutputSource, receiptForOutputSource]) expect(() => codec(value, digest)).toThrow(expect.objectContaining({ code: 'integrity' }));
});
it.each(['scope', 'engine', 'release', 'checkpoint', 'device', 'sum', 'generation'] as const)('rejects validly rehashed mixed %s relationships', kind => {
  const value = source();
  if (kind === 'scope') { value.manifest.result.workspaceId = value.manifest.result.attemptId; reseal(value.manifest.result); }
  if (kind === 'engine') { value.manifest.result.engineId = 'other'; reseal(value.manifest.result); }
  if (kind === 'release') value.release.specDigest = 'f'.repeat(64);
  if (kind === 'checkpoint') value.checkpoint.offset++;
  if (kind === 'device') value.root.device = '1';
  if (kind === 'sum') value.manifest.verifiedBytes++;
  if (kind === 'generation') { Reflect.set(value.manifest.binding, 'generation', 2); }
  rehash(value);
  for (const codec of [verifyOutputSource, receiptForOutputSource]) expect(() => codec(value, digest)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
it.each(['throw', 'uppercase', 'short', 'nonstring'] as const)('reports %s digest-provider failures without producing authority', kind => {
  const provider = () => {
    if (kind === 'throw') throw new Error('synthetic provider');
    if (kind === 'nonstring') return 1 as unknown as string;
    return kind === 'short' ? 'a' : 'A'.repeat(64);
  };
  expect(() => prepareOutputSource(input(), provider)).toThrow(expect.objectContaining({ code: 'digest_failed' }));
  expect(() => verifyOutputSource(source(), provider)).toThrow(expect.objectContaining({ code: 'digest_failed' }));
});
it.each([0, 1, 2])('maps provider failure at hash call %s and supports independent synchronous reentry', failureAt => {
  let count = 0;
  const provider = (text: string) => { if (count++ === failureAt) throw new Error('provider'); return digest(text); };
  expect(() => prepareOutputSource(input(), provider)).toThrow(expect.objectContaining({ code: 'digest_failed' }));
  const nested = vi.fn(() => verifyOutputSource(source(), digest));
  prepareOutputSource(input(), text => { nested(); return digest(text); });
  expect(nested).toHaveBeenCalledTimes(3);
});
it('captures the entire original before a digest provider mutates caller-owned nested fields', () => {
  const original = input(); const expected = prepareOutputSource(original, digest);
  const prepared = prepareOutputSource(original, text => {
    original.binding.engine.id = 'changed'; original.collection.custody.root.directory = '/changed';
    original.release.runtime.evidenceId = 'changed'; original.collection.value.artifacts.length = 0;
    return digest(text);
  });
  expect(prepared).toEqual(expected); expect(assertFrozen(prepared)).toBe(true);
  const stored = source(); const verified = verifyOutputSource(stored, text => {
    stored.root.directory = '/changed'; stored.manifest.binding.engine.id = 'changed'; return digest(text);
  });
  expect(verified).toEqual(expected);
});
it('returns only typed public errors for incomplete receipt inputs', () => {
  expect(() => receiptForOutputSource({ manifestDigest: 'a'.repeat(64) }, digest)).toThrow(OutputSourceError);
});
