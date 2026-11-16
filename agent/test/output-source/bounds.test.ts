import { expect, it, vi } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { captureCollectionIntent, prepareOutputSource, verifyOutputSource, receiptForOutputSource } from '../../src/output-source/index.js';
import { digest, input, intent, reseal, source } from './fixtures.js';

it.each(['hidden', 'symbol', 'getter', 'prototype', 'cycle', 'undefined', 'function', 'bigint', 'nan', 'infinity', 'unsafe'] as const)('rejects original %s data before callbacks without invoking accessors', kind => {
  const value = input(); const provider = vi.fn(digest); const getter = vi.fn(() => 'secret');
  const target = value.binding.engine;
  if (kind === 'hidden') Object.defineProperty(target, 'extra', { value: 1 });
  if (kind === 'symbol') Reflect.set(target, Symbol('extra'), 1);
  if (kind === 'getter') Object.defineProperty(target, 'id', { get: getter, enumerable: true });
  if (kind === 'prototype') Object.setPrototypeOf(target, { inherited: true });
  if (kind === 'cycle') Reflect.set(target, 'extra', value);
  const invalid = { undefined: undefined, function: () => 1, bigint: 1n, nan: NaN, infinity: Infinity, unsafe: Number.MAX_SAFE_INTEGER + 1 };
  if (kind in invalid) Reflect.set(target, 'extra', invalid[kind as keyof typeof invalid]);
  expect(() => prepareOutputSource(value, provider)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  expect(provider).not.toHaveBeenCalled(); expect(getter).not.toHaveBeenCalled();
});
it.each(['sparse', 'extra', 'hidden', 'symbol', 'accessor', 'subclass'] as const)('rejects original %s arrays without getter calls', kind => {
  const value = input(); const items = value.collection.value.artifacts; const getter = vi.fn(() => items[1]);
  if (kind === 'sparse') Reflect.deleteProperty(items, '0');
  if (kind === 'extra') Reflect.set(items, 'extra', 1);
  if (kind === 'hidden') Object.defineProperty(items, 'extra', { value: 1 });
  if (kind === 'symbol') Reflect.set(items, Symbol('extra'), 1);
  if (kind === 'accessor') Object.defineProperty(items, '0', { get: getter, enumerable: true });
  if (kind === 'subclass') Object.setPrototypeOf(items, Object.create(Array.prototype));
  expect(() => prepareOutputSource(value, digest)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  expect(getter).not.toHaveBeenCalled();
});
it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)('maps failed %s capture traps to invalid input', trap => {
  const proxy = new Proxy(input(), { [trap]: () => { throw new Error('trap'); } });
  expect(() => prepareOutputSource(proxy, digest)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
it('bounds original depth, total bytes and collection counts before invoking a provider', () => {
  const provider = vi.fn(digest);
  const deep: Record<string, unknown> = {}; let tail = deep;
  for (let depth = 0; depth < 70; depth++) { const next = {}; tail.next = next; tail = next; }
  const cases: unknown[] = [deep, { huge: 'é'.repeat(131_072) }, Array(4097).fill(null), Object.fromEntries(Array.from({ length: 4097 }, (_, i) => [String(i), null]))];
  for (const value of cases) expect(() => prepareOutputSource(value, provider)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  expect(provider).not.toHaveBeenCalled();
});
it.each(['relative', 'normalized', 'nul', 'utf8', 'uid', 'uint64', 'decimal', 'signed-zero', 'ns-length'] as const)('enforces %s root bounds without native lookup', kind => {
  const value = intent();
  if (kind === 'relative') value.root.directory = 'output';
  if (kind === 'normalized') value.root.directory = '/output/../elsewhere';
  if (kind === 'nul') value.root.directory = '/out\u0000put';
  if (kind === 'utf8') value.root.directory = '/' + 'é'.repeat(2048);
  if (kind === 'uid') value.root.uid = 4_294_967_296;
  if (kind === 'uint64') value.root.inode = '18446744073709551616';
  if (kind === 'decimal') value.root.inode = '01';
  if (kind === 'signed-zero') value.root.modifiedNs = '-0';
  if (kind === 'ns-length') value.root.changedNs = '1'.repeat(33);
  expect(() => captureCollectionIntent(value)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
it('accepts the exact UTF8 path, uint32, uint64 and signed timestamp limits', () => {
  const value = intent(); value.root.directory = '/' + 'é'.repeat(2047) + 'x'; value.root.uid = 4_294_967_295;
  value.root.inode = '18446744073709551615'; value.root.changedNs = '-' + '1'.repeat(31);
  expect(captureCollectionIntent(value)).toEqual(value);
});
it.each(['raw-zero', 'raw-large', 'control-large', 'sum', 'overflow', 'artifacts', 'thresholds'] as const)('rejects %s byte/count debt', kind => {
  const value = input(); const collection = value.collection;
  if (kind === 'raw-zero') collection.custody.resultFileBytes = 0;
  if (kind === 'raw-large') collection.custody.resultFileBytes = 1_048_577;
  if (kind === 'control-large') collection.custody.controlBytes = 67_108_865;
  if (kind === 'sum') collection.verifiedBytes++;
  if (kind === 'overflow') { collection.value.artifacts[0]!.bytes = Number.MAX_SAFE_INTEGER; reseal(collection.value); }
  if (kind === 'artifacts') collection.value.artifacts = Array(129).fill(collection.value.artifacts[0]);
  if (kind === 'thresholds') collection.value.thresholds = Array(257).fill(collection.value.thresholds[0]);
  expect(() => prepareOutputSource(value, digest)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
});
it('accepts exact safe aggregate debt and raw/control scalar boundaries including zero-byte artifacts', () => {
  const value = input(); const collection = value.collection;
  collection.value.artifacts[0]!.bytes = Number.MAX_SAFE_INTEGER - collection.custody.resultFileBytes - collection.custody.controlBytes;
  collection.verifiedBytes = Number.MAX_SAFE_INTEGER; reseal(collection.value);
  expect(prepareOutputSource(value, digest).manifest.verifiedBytes).toBe(Number.MAX_SAFE_INTEGER);
  collection.value.artifacts[0]!.bytes = 0; reseal(collection.value);
  collection.custody.resultFileBytes = 1; collection.custody.controlBytes = 0; collection.verifiedBytes = 1;
  value.checkpoint.offset = 0; value.checkpoint.wrapperSeq = 0;
  expect(prepareOutputSource(value, digest).manifest.verifiedBytes).toBe(1);
  collection.custody.resultFileBytes = 1_048_576; collection.custody.controlBytes = 67_108_864;
  value.checkpoint.offset = 67_108_864; value.checkpoint.wrapperSeq = 1; collection.verifiedBytes = 68_157_440;
  expect(prepareOutputSource(value, digest).manifest.verifiedBytes).toBe(68_157_440);
});
it('accepts a 65536-byte canonical result and rejects one extra byte before hashing', () => {
  const value = input(); const result = value.collection.value;
  const template = result.artifacts[0]!;
  result.artifacts = Array.from({ length: 128 }, () => ({ ...template, relativePath: 'a', bytes: 0 }));
  let padding = 65_536 - Buffer.byteLength(encodeCanonicalJson(result, 131_072));
  expect(padding).toBeGreaterThan(0);
  for (const artifact of result.artifacts) {
    const extra = Math.min(511, padding); artifact.relativePath += 'a'.repeat(extra); padding -= extra;
  }
  expect(padding).toBe(0); reseal(result);
  value.collection.verifiedBytes = value.collection.custody.resultFileBytes + value.collection.custody.controlBytes;
  const prepared = prepareOutputSource(value, digest);
  expect(Buffer.byteLength(encodeCanonicalJson(prepared.manifest.result, 131_072))).toBe(65_536);
  result.artifacts[127]!.relativePath += 'a';
  const provider = vi.fn(digest);
  expect(() => prepareOutputSource(value, provider)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
  expect(provider).not.toHaveBeenCalled();
});
it('rejects closed-field violations at private and receipt boundaries before digest extraction', () => {
  for (const codec of [verifyOutputSource, receiptForOutputSource]) {
    const value = source(); Object.defineProperty(value.release.launch, 'hidden', { value: 1 });
    const provider = vi.fn(digest);
    expect(() => codec(value, provider)).toThrow(expect.objectContaining({ code: 'invalid_input' }));
    expect(provider).not.toHaveBeenCalled();
  }
});
