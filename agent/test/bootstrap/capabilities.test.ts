import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { AdmissionValue } from '../../src/admission/index.js';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { CapabilityView } from '../../src/bootstrap/capabilities.js';
import { configuration, observation } from '../admission/fixtures.js';
import { registration } from '../catalog/fixtures.js';
import { hold, settle, setup } from '../observation/publisher-fixtures.js';

const owners: ReturnType<typeof setup>[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(async () => {
  try { await Promise.all(owners.splice(0).map(f => f.publisher.close())); }
  finally { vi.useRealTimers(); }
});
function fixture() {
  const f = setup(); owners.push(f);
  const options = { configuration: configuration(), catalog: createEngineCatalog([registration()]),
    published: () => f.publisher.snapshot() };
  return { ...f, options, view: new CapabilityView(options) };
}

it('projects only acknowledged resource values and actual composed guards', async () => {
  const f = fixture(); await expect(f.view.capabilities()).rejects.toMatchObject({ status: 503 });
  expect(f.sample).not.toHaveBeenCalled();
  f.publisher.start(); await settle();
  const original = await f.view.capabilities(); expect(original.capacity.cpuMillis).toBeGreaterThan(50);
  const held = hold<AdmissionValue>(); f.admission.mockImplementationOnce(async () => held.promise);
  f.sample.mockImplementationOnce(async () => {
    const value = observation(f.clock.wall); value.capacity.cpuMillis = 250; return value;
  });
  await f.tick();
  try { expect(await f.view.capabilities()).toEqual(original); }
  finally { held.resolve({ stored: true }); }
  await settle();
  const current = await f.view.capabilities(); expect(current.capacity.cpuMillis).toBe(50);
  expect(current.supportedControls).toEqual(['cpu', 'memory', 'pids', 'timeout', 'output']);
  const reads = f.sample.mock.calls.length;
  await f.view.capabilities(); expect(f.sample).toHaveBeenCalledTimes(reads);
  f.guards.timeout = false; await expect(f.view.capabilities()).rejects.toMatchObject({ status: 503 });
});

it('refuses missing guard evidence or unknown evidence instead of inventing controls', async () => {
  const f = fixture(); f.publisher.start(); await settle();
  const frame = f.publisher.snapshot(); if (!frame) throw new Error('Missing test publication');
  const { guards: _guards, ...unattested } = frame.observation; void _guards;
  const missing = new CapabilityView({ ...f.options, published: () => ({ ...frame, observation: unattested }) });
  const unknown = new CapabilityView({ ...f.options, published: () => ({ ...frame,
    observation: { ...frame.observation, status: 'unknown' } }) });
  await expect(missing.capabilities()).rejects.toMatchObject({ status: 503 });
  await expect(unknown.capabilities()).rejects.toMatchObject({ status: 503 });
});
