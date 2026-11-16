import {expect, it} from 'vitest';
import {pollLiveReader} from './poll.js';
it('lets a sibling advance independently, never overlaps originals, and drains held reads on stop', async () => {
 let release!: () => void; const held = new Promise<void>(resolve => {release = resolve;}); const stop = new AbortController();
 let first = 0; let second = 0; let settled = false;
 try {
  const one = pollLiveReader(async () => {first++; await held;}, stop.signal).finally(() => {settled = true;});
  const two = pollLiveReader(async () => {second++;}, stop.signal);
  await new Promise(resolve => setTimeout(resolve, 2100));
  expect(first).toBe(1); expect(second).toBe(2);
  stop.abort(); await two; expect(settled).toBe(false);
  release(); await one; expect(settled).toBe(true); expect(first).toBe(1);
 } finally {stop.abort(); release(); }
});
