import { expect, it, vi } from 'vitest';
import { captureDiskRetention, DISK_HOLD_LIMIT, MAX_DISK_TOTAL } from '../../src/admission/index.js';
const empty = () => ({ cleanupBytes:0,replayBytes:0, heldCount: 0, outputBytes: 0, stagingBytes: 0 });
it('owns frozen retained disk facts without inventing active resource usage', () => {
  const original = { cleanupBytes:0,replayBytes:0, heldCount: 2, outputBytes: 100, stagingBytes: 200 };
  const captured = captureDiskRetention(original); original.outputBytes = 999;
  expect(captured).toEqual({ cleanupBytes:0,replayBytes:0, heldCount: 2, outputBytes: 100, stagingBytes: 200 });
  expect(Object.isFrozen(captured)).toBe(true);
  expect(captureDiskRetention({ cleanupBytes:0,replayBytes:0, heldCount: DISK_HOLD_LIMIT, outputBytes: MAX_DISK_TOTAL, stagingBytes: MAX_DISK_TOTAL }))
    .toEqual({ cleanupBytes:0,replayBytes:0, heldCount: DISK_HOLD_LIMIT, outputBytes: MAX_DISK_TOTAL, stagingBytes: MAX_DISK_TOTAL });
  expect(captureDiskRetention({ cleanupBytes:0,replayBytes:0, heldCount: 1, outputBytes: 0, stagingBytes: 0 })).toEqual({ cleanupBytes:0,replayBytes:0, heldCount: 1, outputBytes: 0, stagingBytes: 0 });
});
it.each([null, [], {}, { ...empty(), heldCount: -1 }, { ...empty(), heldCount: DISK_HOLD_LIMIT + 1 },
  { ...empty(), outputBytes: 1 }, { ...empty(), stagingBytes: 1 }, { cleanupBytes:0,replayBytes:0, heldCount: 1, outputBytes: Infinity, stagingBytes: 0 },
  { cleanupBytes:0,replayBytes:0, heldCount: 1, outputBytes: 1.5, stagingBytes: 0 }, { cleanupBytes:0,replayBytes:0, heldCount: 1, outputBytes: MAX_DISK_TOTAL + 1, stagingBytes: 0 },
  { ...empty(), extra: true }])('rejects malformed retained facts %#', input => {
  expect(() => captureDiskRetention(input)).toThrow('invalid_input');
});
it.each(['hidden', 'symbol', 'accessor'] as const)('checks original %s fields before copying', kind => {
  const input = empty(); const getter = vi.fn(() => 0);
  if (kind === 'hidden') Object.defineProperty(input, 'extra', { value: true });
  if (kind === 'symbol') Object.defineProperty(input, Symbol('extra'), { value: true });
  if (kind === 'accessor') Object.defineProperty(input, 'outputBytes', { get: getter, enumerable: true });
  expect(() => captureDiskRetention(input)).toThrow('invalid_input'); expect(getter).not.toHaveBeenCalled();
});
it('sanitizes foreign carrier failures without leaking their messages', () => {
  const input = new Proxy(empty(), { ownKeys() { throw new Error('private source detail'); } });
  expect(() => captureDiskRetention(input)).toThrow(/^invalid_input$/);
});
