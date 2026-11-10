import { createHash } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { encodeCanonicalJson, sealEngineResult } from '../src/index.js';
import { prepareOutputManifest, verifyOutputManifest, OUTPUT_MANIFEST_PREFIX, OUTPUT_MANIFEST_BYTES,
  OUTPUT_SOURCE_RESULT_BYTES, OutputSourceError } from '../src/output-source/index.js';
import type { PublicCore, PublicManifest } from '../src/output-source/index.js';
import data from '../fixtures/output-source/v1.json' with { type: 'json' };

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[]
  : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
const digest = (text: string): string => createHash('sha256').update(text, 'utf8').digest('hex');
function core(index = 0): Mutable<PublicCore> {
  return JSON.parse(data.vectors[index]!.expected.manifestPreimage.slice(OUTPUT_MANIFEST_PREFIX.length)) as Mutable<PublicCore>;
}
function manifest(): Mutable<PublicManifest> { return { ...core(), manifestDigest: data.vectors[0]!.expected.manifestDigest }; }
function rehash(value: Mutable<PublicManifest>): void {
  const { manifestDigest, ...body } = value; void manifestDigest;
  value.manifestDigest = digest(OUTPUT_MANIFEST_PREFIX + encodeCanonicalJson(body, OUTPUT_MANIFEST_BYTES));
}
function reseal(value: Mutable<PublicCore>): void {
  const { seal, ...body } = value.result;
  const sealed = sealEngineResult(body, seal.sealedAt, digest);
  if (!sealed.ok) throw new Error(`Fixture seal rejected: ${sealed.code}`);
  value.result.seal.sha256 = sealed.value.seal.sha256;
}
function frozen(value: unknown): boolean {
  return value === null || typeof value !== 'object' || Object.isFrozen(value) && Object.values(value).every(frozen);
}
function invalid(input: unknown): void {
  for (const codec of [prepareOutputManifest, verifyOutputManifest]) {
    if (codec === verifyOutputManifest && input !== null && typeof input === 'object' && !Array.isArray(input)) {
      Object.defineProperty(input, 'manifestDigest', { value: 'a'.repeat(64), enumerable: true, configurable: true });
    }
    const provider = vi.fn(digest);
    expect(() => codec(input, provider)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    expect(provider).not.toHaveBeenCalled();
  }
}

it.each(data.vectors)('matches the sole golden $name public preimage, digest and bytes', vector => {
  const value = JSON.parse(vector.expected.manifestPreimage.slice(OUTPUT_MANIFEST_PREFIX.length)) as PublicCore;
  const preimages: string[] = [];
  const prepared = prepareOutputManifest(value, text => { preimages.push(text); return digest(text); });
  expect(preimages).toHaveLength(2);
  expect(preimages[1]).toBe(vector.expected.manifestPreimage);
  expect(prepared.manifestDigest).toBe(vector.expected.manifestDigest);
  expect(Buffer.byteLength(encodeCanonicalJson(prepared, OUTPUT_MANIFEST_BYTES))).toBe(vector.expected.manifestBytes);
  expect(verifyOutputManifest(prepared, digest)).toEqual(prepared);
  expect(frozen(prepared)).toBe(true);
});
it('preserves key order equivalence, private custody independence, raw counts and artifact order', () => {
  const values = data.vectors.map((_, index) => prepareOutputManifest(core(index), digest));
  expect(values[1]).toEqual(values[0]); expect(values[2]).toEqual(values[0]);
  for (const index of [3, 4]) expect(values[index]!.manifestDigest).not.toBe(values[0]!.manifestDigest);
  expect(prepareOutputManifest(Object.fromEntries(Object.entries(core()).reverse()), digest)).toEqual(values[0]);
});
it('retains original UUID spelling and generation one without normalizing mixed spellings', () => {
  const value = core();
  for (const name of ['organizationId', 'workspaceId', 'attemptId'] as const) {
    value.binding[name] = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; value.result[name] = value.binding[name];
  }
  reseal(value);
  expect(prepareOutputManifest(value, digest).binding.attemptId).toBe(value.binding.attemptId);
  value.result.attemptId = value.result.attemptId.toLowerCase(); reseal(value); invalid(value);
});
const relationshipChanges = {
  scope: (v: Mutable<PublicManifest>) => { v.result.workspaceId = v.result.attemptId; reseal(v); },
  engine: (v: Mutable<PublicManifest>) => { v.result.engineId = 'other'; reseal(v); },
  generation: (v: Mutable<PublicManifest>) => { Reflect.set(v.binding, 'generation', 2); },
  sum: (v: Mutable<PublicManifest>) => { v.verifiedBytes++; },
};
it.each(Object.entries(relationshipChanges))('rejects rehashed %s relationships before foreign hashing', (_, change) => {
  const value = manifest(); change(value); rehash(value);
  const provider = vi.fn(digest);
  expect(() => verifyOutputManifest(value, provider)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  expect(provider).not.toHaveBeenCalled();
});
it.each(['result', 'manifest'] as const)('classifies the shaped %s digest mismatch as integrity', kind => {
  const value = manifest();
  if (kind === 'result') { value.result.seal.sha256 = '0'.repeat(64); rehash(value); }
  else value.manifestDigest = '0'.repeat(64);
  expect(() => verifyOutputManifest(value, digest)).toThrow(expect.objectContaining({ code: 'integrity' }));
});
const debtChanges = {
  zero: (v: Mutable<PublicCore>) => { v.resultFileBytes = 0; },
  raw: (v: Mutable<PublicCore>) => { v.resultFileBytes = 1_048_577; },
  control: (v: Mutable<PublicCore>) => { v.controlBytes = 67_108_865; },
  fractional: (v: Mutable<PublicCore>) => { v.controlBytes = 0.5; },
  sum: (v: Mutable<PublicCore>) => { v.verifiedBytes++; },
  overflow: (v: Mutable<PublicCore>) => { v.result.artifacts[0]!.bytes = Number.MAX_SAFE_INTEGER; reseal(v); },
  artifacts: (v: Mutable<PublicCore>) => { v.result.artifacts = Array(129).fill(v.result.artifacts[0]); },
  thresholds: (v: Mutable<PublicCore>) => { v.result.thresholds = Array(257).fill(v.result.thresholds[0]); },
};
it.each(Object.entries(debtChanges))('rejects %s raw/count debt before hashing', (_, change) => {
  const value = core(); change(value); invalid(value);
});
it('accepts exact safe aggregate, raw/control limits, and zero-byte artifacts', () => {
  const value = core();
  value.result.artifacts[0]!.bytes = Number.MAX_SAFE_INTEGER - value.resultFileBytes - value.controlBytes;
  value.verifiedBytes = Number.MAX_SAFE_INTEGER; reseal(value);
  expect(prepareOutputManifest(value, digest).verifiedBytes).toBe(Number.MAX_SAFE_INTEGER);
  value.result.artifacts[0]!.bytes = 0; reseal(value);
  value.resultFileBytes = 1; value.controlBytes = 0; value.verifiedBytes = 1;
  expect(prepareOutputManifest(value, digest).verifiedBytes).toBe(1);
  value.resultFileBytes = 1_048_576; value.controlBytes = 67_108_864; value.verifiedBytes = 68_157_440;
  expect(prepareOutputManifest(value, digest).verifiedBytes).toBe(68_157_440);
});
it('accepts exactly 65536 canonical result bytes and rejects one extra before hashing', () => {
  const value = core(); const result = value.result;
  result.artifacts = Array.from({ length: 128 }, () => ({ ...result.artifacts[0]!, relativePath: 'a', bytes: 0 }));
  let padding = OUTPUT_SOURCE_RESULT_BYTES - Buffer.byteLength(encodeCanonicalJson(result, 131_072));
  expect(padding).toBeGreaterThan(0);
  for (const artifact of result.artifacts) { const extra = Math.min(511, padding); artifact.relativePath += 'a'.repeat(extra); padding -= extra; }
  expect(padding).toBe(0); reseal(value); value.verifiedBytes = value.resultFileBytes + value.controlBytes;
  const prepared = prepareOutputManifest(value, digest);
  expect(Buffer.byteLength(encodeCanonicalJson(prepared.result, 131_072))).toBe(OUTPUT_SOURCE_RESULT_BYTES);
  result.artifacts[127]!.relativePath += 'a'; invalid(value);
});
const closedChanges = {
  hidden: (v: Mutable<PublicCore>) => { Object.defineProperty(v.binding.engine, 'extra', { value: 1 }); },
  symbol: (v: Mutable<PublicCore>) => { Reflect.set(v, Symbol('extra'), 1); },
  prototype: (v: Mutable<PublicCore>) => { Object.setPrototypeOf(v.binding, { inherited: true }); },
  cycle: (v: Mutable<PublicCore>) => { Reflect.set(v.binding, 'extra', v); },
  extra: (v: Mutable<PublicCore>) => { Reflect.set(v, 'privateRoot', {}); },
  sparse: (v: Mutable<PublicCore>) => { Reflect.deleteProperty(v.result.artifacts, '0'); },
  arrayExtra: (v: Mutable<PublicCore>) => { Reflect.set(v.result.artifacts, 'extra', 1); },
  undefined: (v: Mutable<PublicCore>) => { Reflect.set(v.binding, 'extra', undefined); },
  bigint: (v: Mutable<PublicCore>) => { Reflect.set(v.binding, 'extra', 1n); },
  nan: (v: Mutable<PublicCore>) => { v.controlBytes = NaN; },
  infinity: (v: Mutable<PublicCore>) => { v.controlBytes = Infinity; },
  unsafe: (v: Mutable<PublicCore>) => { v.controlBytes = Number.MAX_SAFE_INTEGER + 1; },
  authority: (v: Mutable<PublicCore>) => { v.binding.journalAuthority = 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA'; },
  digest: (v: Mutable<PublicCore>) => { v.binding.intentDigest = 'A'.repeat(64); },
  token: (v: Mutable<PublicCore>) => { v.binding.engine.id = 'bad token'; },
  image: (v: Mutable<PublicCore>) => { v.binding.engine.imageDigest = 'sha256:' + 'A'.repeat(64); },
  config: (v: Mutable<PublicCore>) => { v.binding.engine.configVersion = 0; },
  installed: (v: Mutable<PublicCore>) => { Reflect.set(v.binding.installedIdentity, 'extra', 1); },
};
it.each(Object.entries(closedChanges))('rejects original %s carrier without a digest callback', (_, change) => {
  const value = core(); change(value); invalid(value);
});
it('rejects original accessors without executing them and preserves the typed error', () => {
  const value = core(); const getter = vi.fn(() => 'secret');
  Object.defineProperty(value.binding.engine, 'id', { get: getter, enumerable: true });
  invalid(value); expect(getter).not.toHaveBeenCalled();
  expect(() => prepareOutputManifest(value, digest)).toThrow(OutputSourceError);
});
it('enforces closed prepare/verify shapes, depth, aggregate bytes and own-key bounds', () => {
  expect(() => prepareOutputManifest(manifest(), digest)).toThrow(OutputSourceError);
  expect(() => verifyOutputManifest(core(), digest)).toThrow(OutputSourceError);
  const deep: Record<string, unknown> = {}; let tail = deep;
  for (let depth = 0; depth < 70; depth++) { const next = {}; tail.next = next; tail = next; }
  for (const value of [deep, { huge: 'é'.repeat(OUTPUT_MANIFEST_BYTES) }, Array(4097).fill(null),
    Object.fromEntries(Array.from({ length: 4097 }, (_, index) => [String(index), null]))]) invalid(value);
});
it.each([0, 1])('maps failure at callback %s and supports synchronous independent reentry', failureAt => {
  for (const codec of [prepareOutputManifest, verifyOutputManifest]) {
    const value = codec === prepareOutputManifest ? core() : manifest(); let count = 0;
    const provider = (text: string) => { if (count++ === failureAt) throw new Error('provider'); return digest(text); };
    expect(() => codec(value, provider)).toThrow(expect.objectContaining({ code: 'digest_failed' }));
    const nested = vi.fn(() => verifyOutputManifest(manifest(), digest));
    codec(value, text => { nested(); return digest(text); }); expect(nested).toHaveBeenCalledTimes(2);
  }
});
it.each(['uppercase', 'short', 'nonhex', 'nonstring'] as const)('rejects %s provider output at both hash positions', kind => {
  const outputs = { uppercase: 'A'.repeat(64), short: 'a', nonhex: 'z'.repeat(64), nonstring: 1 };
  for (const failureAt of [0, 1]) {
    let count = 0;
    const provider = (text: string): string => count++ === failureAt ? outputs[kind] as string : digest(text);
    expect(() => prepareOutputManifest(core(), provider)).toThrow(expect.objectContaining({ code: 'digest_failed' }));
  }
});
it('captures every original before provider mutation and recursively freezes independent outputs', () => {
  const original = core(); const expected = prepareOutputManifest(original, digest);
  const prepared = prepareOutputManifest(original, text => {
    original.binding.engine.id = 'changed'; original.result.artifacts.length = 0; original.verifiedBytes = 0; return digest(text);
  });
  expect(prepared).toEqual(expected); expect(frozen(prepared)).toBe(true);
  expect(prepared.binding).not.toBe(original.binding); expect(prepared.result).not.toBe(original.result);
  const stored = manifest();
  const verified = verifyOutputManifest(stored, text => {
    stored.binding.engine.id = 'changed'; stored.result.artifacts.length = 0; stored.manifestDigest = '0'.repeat(64); return digest(text);
  });
  expect(verified).toEqual(expected); expect(frozen(verified)).toBe(true);
  expect(verified.result.artifacts).not.toBe(stored.result.artifacts);
});
