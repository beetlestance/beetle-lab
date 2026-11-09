import { expect, it } from 'vitest';
import { validate } from '../src/index.js';
import { fixture } from './fixtures.js';

it('requires a closed observation on every capability response', async () => {
  const value = await fixture('valid/capabilities.json');
  const checked = validate('Capabilities', value); if (!checked.ok) throw new Error('Invalid fixture');
  for (const field of Object.keys(checked.value.observation)) {
    const copy = structuredClone(checked.value); Reflect.deleteProperty(copy.observation, field);
    expect(validate('Capabilities', copy).ok, field).toBe(false);
  }
  expect(validate('Capabilities', { ...checked.value, observation: undefined }).ok).toBe(false);
  expect(validate('CapacityObservation', { ...checked.value.observation, privatePath: '/fixture-only' }).ok).toBe(false);
});

it('keeps nullable optional sensors explicit and refuses invented physical capacity or unknown provenance', async () => {
  const checked = validate('CapacityObservation', await fixture('valid/capacity-observation.json'));
  if (!checked.ok) throw new Error('Invalid fixture');
  const value = checked.value;
  expect(validate('CapacityObservation', { ...value, idle: { source: 'fixture', observedAtMs: value.observedAtMs, value: null },
    thermal: { source: 'fixture', observedAtMs: value.observedAtMs, celsius: null },
    thermalPolicy: { source: 'fixture', configuredAtMs: value.sampleStartedAtMs, maximumCelsius: 90 } }).ok).toBe(true);
  for (const change of [{ physicalPidCapacity: 4096 }, { clock: 'receipt-time' }, { maxConcurrent: 65 },
    { provenance: { ...value.provenance, cpuMillis: 'unavailable' } }, { pool: { ...value.pool, stagingBytes: 0 } },
    { guards: { ...value.guards, controls: ['timeout', 'timeout'] } }, { runtimeControls: ['hard-output-quota'] },
    { expiresAtMs: Number.MAX_SAFE_INTEGER }, { perRunStagingBytes: 0 }]) {
    expect(validate('CapacityObservation', { ...value, ...change }).ok).toBe(false);
  }
});

it('leaves clock freshness and cross-field authority to the receiver instead of treating shape as attestation', async () => {
  const checked = validate('CapacityObservation', await fixture('valid/capacity-observation.json'));
  if (!checked.ok) throw new Error('Invalid fixture');
  // Archived or inconsistent timestamps can be structurally valid; the adapter must reject their use.
  expect(validate('CapacityObservation', { ...checked.value, expiresAtMs: checked.value.sampleStartedAtMs }).ok).toBe(true);
});
