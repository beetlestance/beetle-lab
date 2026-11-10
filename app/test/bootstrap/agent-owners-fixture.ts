import { vi } from 'vitest';
import type { DeliveryRuntimeOptions } from '../../src/ports/delivery.js';
import type { CapacitySource } from '../../src/ports/runtime.js';
import type { RunnerGateway } from '../../src/ports/runner.js';
import { observation, settingsFixture } from '../storage/fixture.js';

export function deferred<T>() {
  let resolve!: (value: T) => void; let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export async function flush(): Promise<void> { for (let i = 0; i < 20; i++) await Promise.resolve(); }
async function unexpected(): Promise<never> { throw new Error('Unexpected fixture operation'); }

export function ownerFixture(start: ReturnType<typeof vi.fn>) {
  const frame = observation(settingsFixture().runtime, 10000, 1000);
  const source: CapacitySource = { sample: vi.fn(async () => frame), close: vi.fn(async () => {}) };
  const gateway: RunnerGateway = { capabilities: vi.fn(unexpected), attempt: vi.fn(() => { throw new Error('Unexpected client'); }),
    close: vi.fn(async () => {}) };
  const metadata = { dispatch: { scan: vi.fn(unexpected), readOffer: vi.fn(unexpected), claim: vi.fn(unexpected), observe: vi.fn(unexpected) },
    runs: { execute: vi.fn(unexpected), getRun: vi.fn(unexpected), listRuns: vi.fn(unexpected) },
    updateRuntime: vi.fn(async (value: typeof frame | null): Promise<null> => { void value; return null; }) };
  let options: DeliveryRuntimeOptions | undefined;
  let notification: Promise<void> | undefined;
  let failure: { error: unknown } | undefined;
  const delivery = { state: () => ({ status: 'running' as const, active: false, reason: null }),
    close: vi.fn(async () => {
      if (notification) {
        try { await notification; }
        catch (error) { throw new AggregateError([failure?.error, error], 'Fixture delivery failure', { cause: error }); }
      }
      if (failure) throw failure.error;
    }) };
  start.mockImplementation((captured: DeliveryRuntimeOptions) => { options = captured; return delivery; });
  function fail(error: unknown): Promise<void> {
    if (!options) throw new Error('Delivery did not start');
    failure = { error }; notification = options.onFailure(error); return notification;
  }
  return { frame, source, gateway, metadata, delivery, fail, options: () => options };
}
