import {expect, it, vi} from 'vitest';
import {joinReads} from './reads.js';
it('does not expose a failed read to cleanup until its held sibling settles', async () => {
 let release!: (value: number) => void; const held = new Promise<number>(resolve => {release = resolve;});
 const failure = Error('synthetic first read'); const after = vi.fn();
 const observed = joinReads([Promise.reject(failure), held]).then(after, error => {after(); return error as unknown;});
 await Promise.resolve(); await Promise.resolve(); expect(after).not.toHaveBeenCalled();
 release(2); expect(await observed).toBe(failure); expect(after).toHaveBeenCalledTimes(1);
});
it('returns joined successful values in their original request order', async () => {
 expect(await joinReads([Promise.resolve(2), Promise.resolve(1)])).toEqual([2, 1]);
});
