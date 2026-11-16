import { vi } from 'vitest';
import type { AdmissionValue, RuntimeObservation } from '../../src/admission/index.js';
import type { PublisherOptions } from '../../src/observation/publisher-types.js';
import { createObservationPublisher } from '../../src/observation/publisher.js';
import { observation } from '../admission/fixtures.js';

export function hold<T>() {
  let resolve!: (value: T) => void; let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
// Controlled ports and clocks exercise local ordering, not native resource guarantees.
export function setup(overrides: Partial<PublisherOptions> = {}) {
  const clock = { wall: 100_000, mono: 1000 };
  const guards = { output: true, timeout: true };
  const frames: RuntimeObservation[] = [];
  const sample = vi.fn(async () => observation(clock.wall));
  const admission = vi.fn(async (input: Parameters<PublisherOptions['journal']['admission']>[0]): Promise<AdmissionValue> => {
    if (input.kind !== 'observe') throw new Error('unexpected command');
    frames.push(input.observation); return { stored: true };
  });
  const options: PublisherOptions = { journal: { admission }, observer: { sample },
    output: { status: () => ({ ready: guards.output, running: true, closed: false, watched: 0 }) },
    timeout: { status: () => ({ ready: guards.timeout, running: true, closed: false, watched: 0, stopRequested: false, reason: null }) },
    intervalMs: 10, sampleTimeoutMs: 30, ttlMs: 100,
    wallNow: () => clock.wall, monotonicNow: () => clock.mono, ...overrides };
  const publisher = createObservationPublisher(options);
  return { publisher, options, clock, guards, frames, sample, admission,
    async tick(ms = 10) { clock.wall += ms; clock.mono += ms; await vi.advanceTimersByTimeAsync(ms); } };
}
export async function settle() { for (let index = 0; index < 15; index++) await Promise.resolve(); }
