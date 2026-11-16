import { expect, it, vi } from 'vitest';
import { Ownership } from '../../../src/application/inputs/ownership.js';

const turn = () => new Promise<void>(resolve => setImmediate(resolve));
it.each([false, true])('reserves call ownership before reentrant close; rejection=%s', async rejected => {
  const ownership = new Ownership(); let resolve!: () => void; let reject!: (value: Error) => void;
  const original = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  let closing: Promise<void> | undefined; let closed = false;
  const result = ownership.call(() => {
    closing = ownership.close(); void closing.then(() => { closed = true; });
    return original;
  }).catch((error: unknown) => error);
  try {
    await turn(); expect(closed).toBe(false);
    const forbidden = vi.fn(async () => undefined);
    expect(() => ownership.call(forbidden)).toThrow(); expect(forbidden).not.toHaveBeenCalled();
  } finally {
    if (rejected) reject(new Error('controlled original rejection')); else resolve();
    await result; await closing;
  }
  expect(closed).toBe(true); expect(ownership.close()).toBe(closing);
});

it('settles a synchronous foreign exception without leaking a reserved call', async () => {
  const ownership = new Ownership(); const failure = new Error('controlled issue failure');
  await expect(ownership.call(() => { throw failure; })).rejects.toBe(failure);
  await ownership.close();
});
