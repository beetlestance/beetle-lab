import { expect, it, vi } from 'vitest';
import type { InputTransferClient } from '@beetle/contracts/api';
import { SessionTransferOwner } from './transfer-owner.js';

function deferred() {
  let resolve!: () => void; let reject!: (reason: unknown) => void;
  const promise = new Promise<void>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function client(close: () => Promise<void>): InputTransferClient {
  const unused = async (): Promise<never> => { throw new Error('Unexpected transfer'); };
  return { prepare: unused, append: unused, download: unused, close };
}
const options = { baseUrl: 'http://localhost' };

it('aborts the old client and waits for original drainage before opening another session', async () => {
  const held = deferred(); const close = vi.fn(() => held.promise);
  const first = client(close); const second = client(async () => undefined);
  const factory = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(second);
  const owner = new SessionTransferOwner(factory); const epoch = new AbortController();
  expect(await owner.open(options, epoch.signal)).toBe(first); epoch.abort();
  const draining = owner.retire(); expect(owner.retire()).toBe(draining); expect(close).toHaveBeenCalledTimes(1);
  let opened = false; const next = owner.open(options, new AbortController().signal).then(value => { opened = true; return value; });
  await Promise.resolve(); expect(opened).toBe(false); expect(factory).toHaveBeenCalledTimes(1);
  held.resolve(); expect(await next).toBe(second); expect(factory).toHaveBeenCalledTimes(2); await owner.retire();
});

it('never installs a retired replacement and fences replacement after failed cleanup', async () => {
  const held = deferred(); const factory = vi.fn(() => client(() => held.promise));
  const owner = new SessionTransferOwner(factory);
  await owner.open(options, new AbortController().signal); const closing = owner.retire();
  const epoch = new AbortController(); const replacement = owner.open(options, epoch.signal); epoch.abort();
  const failure = new Error('Synthetic close failure'); held.reject(failure);
  await expect(closing).rejects.toBe(failure); await expect(replacement).rejects.toBe(failure);
  await expect(owner.open(options, new AbortController().signal)).rejects.toBe(failure);
  expect(factory).toHaveBeenCalledTimes(1);
});

it('removes retired abort listeners and retains reentrant close before its promise returns', async () => {
  const held = deferred(); let reentered: Promise<void> | undefined;
  const factory = vi.fn(() => client(() => { reentered = owner.retire(); return held.promise; }));
  const owner = new SessionTransferOwner(factory); const epoch = new AbortController();
  await owner.open(options, epoch.signal);
  const closing = owner.retire(); expect(reentered).toBe(closing);
  epoch.abort(); expect(factory).toHaveBeenCalledTimes(1); held.resolve(); await closing;
  await owner.open(options, new AbortController().signal); await owner.retire();
});

it('closes a client if its factory retires the epoch before returning', async () => {
  const epoch = new AbortController(); const close = vi.fn(async () => undefined);
  const owner = new SessionTransferOwner(() => { epoch.abort(); return client(close); });
  expect(await owner.open(options, epoch.signal)).toBeUndefined(); expect(close).toHaveBeenCalledTimes(1);
});
