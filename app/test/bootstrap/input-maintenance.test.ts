import { afterEach, expect, it, vi } from 'vitest';
import type { InputOperationContext, InputRecoveryResult, InputService } from '../../src/ports/input-service.js';
import type { InputRecoveryPage } from '../../src/ports/inputs.js';
import { InputMaintenance } from '../../src/bootstrap/input-maintenance.js';

const empty = (): InputRecoveryResult => ({ examined: 0, reconciled: 0, busy: 0, pending: 0, nextCursor: null });
afterEach(() => { vi.useRealTimers(); });

it('runs only pending bounded pages and restarts its cursor after a pass', async () => {
  vi.useFakeTimers();
  const recover = vi.fn<InputService['recover']>().mockResolvedValueOnce({ ...empty(), examined: 16, reconciled: 16, nextCursor: 'first-page' })
    .mockResolvedValueOnce(empty()).mockResolvedValueOnce(empty());
  const maintenance = new InputMaintenance({ recover });
  await vi.advanceTimersByTimeAsync(0);
  expect(recover).toHaveBeenCalledExactlyOnceWith({ mode: 'pending', limit: 16 }, { signal: expect.any(AbortSignal) });
  await vi.advanceTimersByTimeAsync(4999); expect(recover).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(recover.mock.calls[1]![0]).toEqual({ mode: 'pending', limit: 16, cursor: 'first-page' });
  await vi.advanceTimersByTimeAsync(5000);
  expect(recover.mock.calls[2]![0]).toEqual({ mode: 'pending', limit: 16 });
  await maintenance.close(); expect(maintenance.state).toBe('closed'); expect(vi.getTimerCount()).toBe(0);
});

it('retains the sole original through cancellation/close and never queues another page', async () => {
  vi.useFakeTimers(); let finish!: (value: InputRecoveryResult) => void; let signal: AbortSignal | undefined;
  const recover = vi.fn((_query: InputRecoveryPage, context?: InputOperationContext) => {
    signal = context?.signal; return new Promise<InputRecoveryResult>(resolve => { finish = resolve; });
  });
  const maintenance = new InputMaintenance({ recover }); await vi.advanceTimersByTimeAsync(0);
  await vi.advanceTimersByTimeAsync(30_000); expect(recover).toHaveBeenCalledTimes(1); expect(maintenance.state).toBe('running');
  let done = false; const closing = maintenance.close().then(() => { done = true; });
  expect(signal?.aborted).toBe(true); await vi.advanceTimersByTimeAsync(30_000);
  expect(done).toBe(false); expect(recover).toHaveBeenCalledTimes(1);
  finish(empty()); await closing; expect(done).toBe(true); expect(vi.getTimerCount()).toBe(0);
});

it.each(['rejection', 'counts', 'cursor'] as const)('surfaces %s failure and stops automatic scheduling', async kind => {
  vi.useFakeTimers();
  const recover = vi.fn(async () => {
    if (kind === 'rejection') throw new Error('SYNTHETIC_PRIVATE_CANARY');
    return kind === 'counts' ? { ...empty(), examined: 17 } : { ...empty(), nextCursor: 'x'.repeat(1025) };
  });
  const maintenance = new InputMaintenance({ recover }); await vi.advanceTimersByTimeAsync(0);
  expect(maintenance.state).toBe('failed'); await vi.advanceTimersByTimeAsync(30_000); expect(recover).toHaveBeenCalledTimes(1);
  const error: unknown = await maintenance.close().catch((value: unknown) => value);
  expect(String(error)).toContain('Input recovery failed'); expect(String(error)).not.toContain('CANARY');
  expect(vi.getTimerCount()).toBe(0);
});

it('closes before its first scheduled issue without calling storage', async () => {
  vi.useFakeTimers(); const recover = vi.fn(async () => empty()); const maintenance = new InputMaintenance({ recover });
  await maintenance.close(); await vi.advanceTimersByTimeAsync(30_000);
  expect(recover).not.toHaveBeenCalled(); expect(vi.getTimerCount()).toBe(0);
});
