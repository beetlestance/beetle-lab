import { expect, it, vi } from 'vitest';
import { RuntimeCapacity } from '../../src/adapters/outbound/sqlite/runtime.js';
import { observation, settingsFixture, storageFixture } from './fixture.js';

it('retains one immutable execution/display lease and revokes both at original expiry', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    const source = observation(settingsFixture().runtime, 10000, 1000);
    const runtime = new RuntimeCapacity({ installation: settingsFixture().chain.installation, runtime: source });
    const captured = runtime.currentObservation();
    source.execution.stagingBytes = 1;
    expect(captured?.execution).toEqual({ stagingBytes: 10485760, perRunStagingBytes: 2097152 });
    expect(Object.isFrozen(captured?.execution)).toBe(true);
    expect(runtime.snapshot()).toBe(captured?.ceilings);
    clock.mockReturnValue(11000);
    expect(runtime.currentObservation()).toBeNull(); expect(runtime.snapshot()).toBeNull();
  } finally { clock.mockRestore(); }
});
it('revokes conflicting equal-time staging even with identical display ceilings', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    const source = observation(settingsFixture().runtime, 10000);
    const runtime = new RuntimeCapacity({ installation: settingsFixture().chain.installation, runtime: source });
    source.execution.perRunStagingBytes--;
    expect(() => runtime.update(source)).toThrow();
    expect(runtime.currentObservation()).toBeNull(); expect(runtime.snapshot()).toBeNull();
  } finally { clock.mockRestore(); }
});
const fixture = storageFixture();
it.each([
  undefined, null, {}, { stagingBytes: 1, perRunStagingBytes: 2 },
  { stagingBytes: 0, perRunStagingBytes: 1 }, { stagingBytes: 2, perRunStagingBytes: 0 },
  { stagingBytes: 2, perRunStagingBytes: 0.5 },
  { stagingBytes: Number.MAX_SAFE_INTEGER, perRunStagingBytes: 1 },
  { stagingBytes: 2, perRunStagingBytes: 1, freeBytes: 2 },
])('rejects malformed execution policy at parent ingress: %j', async execution => {
  const metadata = await fixture.open();
  await expect(metadata.updateRuntime({ ...observation(), execution } as never)).rejects.toMatchObject({ code: 'invalid_input' });
});
it('also refuses malformed policy at the worker boundary', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    expect(() => new RuntimeCapacity({ installation: settingsFixture().chain.installation,
      runtime: { ...observation(settingsFixture().runtime, 10000), execution: undefined } as never })).toThrow();
  } finally { clock.mockRestore(); }
});
