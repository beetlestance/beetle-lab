import { expect, it } from 'vitest';
import { captureNativeCleanupPlan, captureNativeDirectory, nativeCleanupPlanIdentity, cleanupControl, cleanupPayloadBytes } from '../../src/cleanup-control/index.js';
import { plan, directory } from './fixture.js';
it('keeps exact native integers beyond Number precision, immutable spelling and canonical identities', () => {
  const original = plan(); const copy = captureNativeCleanupPlan(original);
  expect(copy).toEqual(original); expect(copy).not.toBe(original);
  expect(copy.entries[0]!.native.dev).toBe('9007199254740993');
  const changed = { ...copy, entries: [{ path: '', kind: 'directory' as const, native: { ...directory, ino: '9007199254740996' } }] };
  expect(nativeCleanupPlanIdentity(changed)).not.toBe(nativeCleanupPlanIdentity(copy));
  for (const bad of [9007199254740992, '01', '-1', '1e3', '18446744073709551616']) expect(() => captureNativeDirectory({ ...directory, ino: bad })).toThrow();
  expect(cleanupPayloadBytes).toBe(169984); expect(cleanupPayloadBytes).toBeLessThan(cleanupControl.reservedBytes);
});
it('rejects unknown effects, foreign tree structure, links, escapes and unsupported purposes', () => {
  const base = plan();
  for (const patch of [{ delete: true }, { purpose: 'standalone_export' }, { protocolVersion: 2 }, { retirementVersion: 2 },
    { original: { ...base.original, generation: 2 } }, { namespaceIdentity: 'A'.repeat(64) }]) expect(() => captureNativeCleanupPlan({ ...base, ...patch })).toThrow();
  for (const name of ['../escape', '/absolute', 'input//child', 'input/./child', 'input/../child', 'input\\child', 'input/\0x', '\ud800', 'missing/child']) {
    expect(() => captureNativeCleanupPlan({ ...base, entries: [base.entries[0], { ...base.entries[2], path: name }] })).toThrow();
  }
  expect(() => captureNativeCleanupPlan({ ...base, entries: [base.entries[0], base.entries[1], base.entries[1]] })).toThrow();
  expect(() => captureNativeCleanupPlan({ ...base, entries: [base.entries[0], base.entries[2], base.entries[1]] })).toThrow();
  expect(() => captureNativeCleanupPlan({ ...base, entries: [base.entries[0], base.entries[1], { ...base.entries[2], native: { ...base.entries[2]!.native, links: '2' } }] })).toThrow();
});
it('independently bounds entries, depth, UTF8 paths and complete serialization', () => {
  const base = plan(); const root = base.entries[0]!;
  const entries = [root, ...Array.from({ length: 511 }, (_, n) => ({ path: 'f' + String(n).padStart(3, '0'), kind: 'directory' as const, native: { ...directory, ino: String(100 + n) } }))];
  expect(captureNativeCleanupPlan({ ...base, entries }).entries).toHaveLength(512);
  expect(() => captureNativeCleanupPlan({ ...base, entries: [...entries, { ...root, path: 'zzz' }] })).toThrow();
  const wide = [root, ...Array.from({ length: 400 }, (_, n) => ({ ...root, native: { ...directory, ino: String(100 + n) }, path: String(n).padStart(3, '0') + '界'.repeat(120) }))];
  expect(() => captureNativeCleanupPlan({ ...base, entries: wide })).toThrow();
  const chain = Array.from({ length: 32 }, (_, n) => ({ ...root, native: { ...directory, ino: String(100 + n) },
    path: Array.from({ length: n + 1 }, () => 'x').join('/') }));
  expect(captureNativeCleanupPlan({ ...base, entries: [root, ...chain] }).entries).toHaveLength(33);
  expect(() => captureNativeCleanupPlan({ ...base, entries: [root, ...chain, { ...root, native: { ...directory, ino: '999' }, path: 'x/'.repeat(32) + 'x' }] })).toThrow();
  const unicode = Array.from({ length: 17 }, (_, n) => ({ ...root, native: { ...directory, ino: String(100 + n) },
    path: Array.from({ length: n + 1 }, () => '界'.repeat(80)).join('/') }));
  expect(Buffer.byteLength(unicode.at(-1)!.path)).toBe(4096);
  expect(captureNativeCleanupPlan({ ...base, entries: [root, ...unicode] }).entries).toHaveLength(18);
  const last = unicode.at(-1)!;
  expect(() => captureNativeCleanupPlan({ ...base, entries: [root, ...unicode.slice(0, -1), { ...last, path: last.path + 'a' }] })).toThrow();
});
