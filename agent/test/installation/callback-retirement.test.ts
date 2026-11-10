import { expect, it, vi } from 'vitest';
import { Watch as OutputWatch } from '../../src/guard/watch.js';
import { Watch as TimeoutWatch } from '../../src/timeout/watch.js';
import { fixture, operation, scope } from './fixtures.js';
import { deferred, entries, managers } from './delivery-fixtures.js';
const f = fixture(); const create = managers();

it.each(['output', 'timeout'] as const)('retirement drains the issued %s private callback before capturing its late cancellation chain', async kind => {
  const e = await f.setup(); const manager = create(e.options); await e.accepted(manager); await manager.drive(scope(e.offer), operation());
  const entry = [...entries(manager).values()][0]!; const started = deferred<void>(); const callbackGate = deferred<void>(); const cancellationGate = deferred<void>();
  const read = e.owner.readOutputSource.bind(e.owner);
  vi.spyOn(e.owner, 'readOutputSource').mockImplementationOnce(async key => { const source = await read(key); expect(source).toBeNull(); started.resolve(); await callbackGate.promise; return source; });
  const cancel = entry.controller!.cancel.bind(entry.controller!);
  vi.spyOn(entry.controller!, 'cancel').mockImplementation(async reason => { await cancel(reason); await cancellationGate.promise; });
  const close = vi.spyOn(entry.controller!, 'close');
  let watch: OutputWatch | TimeoutWatch;
  if (kind === 'output') {
    await entry.watch!.close();
    const actual = new OutputWatch({ key: entry.key, plan: entry.plan!, outputBytes: e.offer.budget.outputBytes },
      () => undefined, () => manager.stopGuard(entry), () => undefined);
    entry.watch = actual; actual.stop('artifact_incomplete'); watch = actual;
  } else {
    await entry.timeout!.close();
    const actual = new TimeoutWatch({ key: entry.key, admittedAt: 100_000, timeoutMs: 1000, sampledAt: 0,
      clockHighWater: 100_000, clockFenced: false }, { ready: () => true, check: () => undefined,
      stop: reason => manager.stopTimeout(entry, reason), retire: () => undefined });
    entry.timeout = actual; actual.stop('timeout'); watch = actual;
  }
  await started.promise; expect(entry.leases.size).toBe(0); expect(entry.cancellation).toBeUndefined();
  const retirement = manager.retire(entry);
  try {
    await vi.waitFor(() => expect(watch.closed).toBe(true)); expect(close).not.toHaveBeenCalled();
    callbackGate.resolve();
    await vi.waitFor(() => expect(entry.cancellation).toBeDefined());
    await (kind === 'output' ? entry.watchClosing : entry.timeoutClosing);
    expect(close).not.toHaveBeenCalled(); expect(entries(manager).size).toBe(1);
    cancellationGate.resolve(); await retirement;
    expect(close).toHaveBeenCalledTimes(1); expect(entries(manager).size).toBe(0); expect(e.manager.size).toBe(0);
  } finally { callbackGate.resolve(); cancellationGate.resolve(); await Promise.allSettled([retirement]); }
});
