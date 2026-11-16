import { expect, it, vi } from 'vitest';
import { createTimeoutGuard } from '../../src/timeout/index.js';
import type { InstallationController } from '../../src/installation/index.js';
import type { Preparation } from '../../src/staging/index.js';
import { controlled } from '../supervisor/fixtures.js';
import { deferred, fixture, operation, scope } from './fixtures.js';

const f = fixture();
it('requests timeout during held original preparation and prevents late launch', async () => {
  const e = await f.setup(); const original = deferred<void>(); let signal: AbortSignal | undefined;
  const timeout = createTimeoutGuard({ wallNow: e.time.wall, monotonicNow: e.time.monotonic,
    stop: (key, reason) => manager.stop(key, reason) });
  const prepare = vi.fn((input: Parameters<typeof e.stager.prepare>[0]): Preparation => {
    signal = input.operation.signal;
    const actual = e.stager.prepare(input);
    return { result: actual.result, quiesced: Promise.all([actual.quiesced, original.promise]).then(() => undefined) };
  });
  const manager = e.create({ timeout, monotonicNow: e.time.monotonic, stagerFor: () => ({ prepare }) });
  timeout.start(); await e.accepted(manager); const driving = manager.drive(scope(e.offer), operation());
  try {
    await vi.waitFor(() => { expect(prepare).toHaveBeenCalledOnce(); });
    e.time.advance(e.offer.budget.timeoutMs); timeout.status();
    await vi.waitFor(async () => {
      expect(await e.owner.supervision({ key: scope(e.offer), now: e.time.wall() })).toMatchObject({ cancelReason: 'timeout' });
    });
    expect(signal?.aborted).toBe(true); expect(e.backend.creates).toBe(0);
    expect((await manager.inspect(scope(e.offer))).allocation?.status).toBe('charged');
  } finally { original.resolve(); await driving; await manager.close(); await timeout.close(); }
  expect((await e.owner.admission({ kind: 'reservation', key: scope(e.offer) }))).toMatchObject({ status: 'released', aborted: true });
  expect(e.backend.starts).toBe(0);
});

it('uses the original admission deadline after restart without staging or starting again', async () => {
  const e = await f.setup(); const first = e.create(); await e.accepted(first);
  await first.drive(scope(e.offer), operation()); expect(e.backend.starts).toBe(1);
  await f.close(e.owner); const journal = await f.open(e.journalPath);
  e.time.advance(e.offer.budget.timeoutMs + 1);
  const recovered = controlled(journal, e.time, e.backend); const prepare = vi.fn();
  const timeout = createTimeoutGuard({ wallNow: e.time.wall, monotonicNow: e.time.monotonic,
    stop: (key, reason) => manager.stop(key, reason) });
  const manager = e.create({ journal, supervisor: recovered.manager, timeout, monotonicNow: e.time.monotonic,
    stagerFor: () => ({ prepare }) }); timeout.start();
  try {
    await manager.drive(scope(e.offer), operation());
    expect(await journal.supervision({ key: scope(e.offer), now: e.time.wall() })).toMatchObject({ cancelReason: 'timeout' });
    expect(await e.finish(manager)).toMatchObject({ kind: 'released' });
    expect(prepare).not.toHaveBeenCalled(); expect(e.backend.starts).toBe(1);
  } finally { await manager.close(); await timeout.close(); }
});

it('persists clock integrity without inventing a wall timestamp when local monotonic time fails', async () => {
  const e = await f.setup(); const manager = e.create({ monotonicNow: () => NaN });
  await e.accepted(manager);
  expect(await manager.drive(scope(e.offer), operation())).toMatchObject({ kind: 'released' });
  expect(await e.owner.supervision({ key: scope(e.offer), now: e.time.wall() }))
    .toMatchObject({ cancelReason: 'clock_integrity', clockFenced: true, immediateStop: true });
  expect(await e.owner.readOutputAbsence(scope(e.offer))).toMatchObject({ reason: 'clock_integrity',
    admission: { state: 'released', disposition: 'never_started' } });
  expect(e.backend.creates).toBe(0);
});

it('adopts and drains a timeout handle returned during reentrant installation shutdown', async () => {
  const e = await f.setup(); let closing: Promise<void> | undefined; const original = deferred<void>();
  const close = vi.fn(() => original.promise);
  const manager: InstallationController = e.create({ timeout: { watch() {
    closing = manager.close();
    return { status: () => ({ ready: true, closed: false, stopRequested: false, reason: null }), close };
  } } });
  await e.accepted(manager); const driving = manager.drive(scope(e.offer), operation());
  const rejected = expect(driving).rejects.toMatchObject({ reason: 'closed' });
  try { await vi.waitFor(() => { expect(close).toHaveBeenCalledOnce(); }); expect(e.backend.creates).toBe(0); }
  finally { original.resolve(); await rejected; await closing; }
});
