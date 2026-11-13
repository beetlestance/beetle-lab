import { expect, it } from 'vitest';
import { NativeCustody, NativeCustodyError } from '../../src/collection/native-custody/index.js';
function bound(registry: NativeCustody, kind: 'collection' | 'range' | 'cleanup', directory: string) {
 const lease = registry.reserve(kind)!; lease.own({}); lease.bind(directory); return lease;
}
it('preserves each two-owner lane while sharing the original aggregate four credits', () => {
 const registry = new NativeCustody(); const held = [bound(registry,'collection','/jobs/a/output'),bound(registry,'collection','/jobs/b/output')];
 expect(registry.reserve('collection')).toBeUndefined(); held.push(bound(registry,'range','/jobs/c/output'),bound(registry,'range','/jobs/d/output'));
 expect(registry.reserve('cleanup')).toBeUndefined(); expect(registry.status()).toEqual({retained:4,collection:2,range:2,cleanup:0});
 held.pop()!.release(); const cleanup = bound(registry,'cleanup','/jobs/e'); expect(registry.status().retained).toBe(4);
 cleanup.release(); for(const lease of held)lease.release(); expect(registry.status().retained).toBe(0);
});
it('permits overlapping readers and refuses overlapping cleanup in either ancestor direction', () => {
 for(const cleanupScope of ['/jobs/a','/jobs/a/output','/jobs/a/output/deep']) {
  const registry = new NativeCustody(); const first = bound(registry,'collection','/jobs/a/output');
  const second = bound(registry,'range','/jobs/a/output'); const cleanup = registry.reserve('cleanup')!;cleanup.own({});
  expect(()=>cleanup.bind(cleanupScope)).toThrowError(new NativeCustodyError('busy'));
  cleanup.release();second.release();first.release();
 }
});
it('blocks late reader scope binding against a reserved or bound cleanup, without confusing sibling prefixes', () => {
 const registry = new NativeCustody();const cleanup = bound(registry,'cleanup','/jobs/a');
 const reader = registry.reserve('range')!; reader.own({});expect(()=>reader.bind('/jobs/a/output')).toThrowError(new NativeCustodyError('busy'));reader.release();
 const sibling=bound(registry,'range','/jobs/ab/output');sibling.release();cleanup.release();
 const unbound=registry.reserve('cleanup')!;unbound.own({});const late=registry.reserve('collection')!;late.own({});
 expect(()=>late.bind('/jobs/z/output')).toThrowError(new NativeCustodyError('busy'));late.release();unbound.release();
});
it('refuses cleanup while a prior reader is still capturing scope and never treats an unbound owner as disjoint', () => {
 const registry=new NativeCustody();const reader=registry.reserve('range')!;reader.own({});const cleanup=registry.reserve('cleanup')!;cleanup.own({});
 expect(()=>cleanup.bind('/jobs/a')).toThrowError(new NativeCustodyError('busy'));cleanup.release();reader.bind('/jobs/a/output');reader.release();
});
it('requires a strong owner, one canonical non-root scope and one binding; released handles cannot reenter', () => {
 const registry=new NativeCustody();const lease=registry.reserve('cleanup')!;
 expect(()=>lease.bind('/jobs/a')).toThrow();lease.own({});expect(()=>lease.own({})).toThrow();
 for(const path of ['/','relative','/jobs/../a','/jobs/a/','/jobs/\0a'])expect(()=>lease.bind(path)).toThrow();
 lease.bind('/jobs/a');expect(()=>lease.bind('/jobs/b')).toThrow();lease.release();lease.release();expect(()=>lease.bind('/jobs/a')).toThrowError(new NativeCustodyError('released'));
});
