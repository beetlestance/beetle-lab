import { expect, it, vi } from 'vitest';
import { createRuntimePublisher } from '../../src/bootstrap/runtime-publication.js';
import { StorageError } from '../../src/adapters/outbound/sqlite/index.js';
import type { ErrorCode } from '../../src/adapters/outbound/sqlite/index.js';
import { settingsFixture } from '../domain/fixtures.js';
const value = () => ({ ceilings: settingsFixture().runtime, observedAtMs: 100, expiresAtMs: 1100 });
it('publishes original source time and does not retry a rejected operation', async () => {
  const updateRuntime = vi.fn().mockResolvedValue(null); const publish = createRuntimePublisher({ updateRuntime });
  const source = value(); expect(await publish(source)).toBe(true);
  expect(updateRuntime.mock.calls).toEqual([[source]]);
});
it.each(['invalid_input', 'invalid_value'] as const)('returns explicit refusal for %s and preserves null-write errors', async code => {
  const error = new StorageError(code); const updateRuntime = vi.fn().mockRejectedValue(error);
  const publish = createRuntimePublisher({ updateRuntime });
  expect(await publish(value())).toBe(false); await expect(publish(null)).rejects.toBe(error);
  expect(updateRuntime).toHaveBeenCalledTimes(2);
});
it.each(['unavailable', 'queue_full', 'closed', 'owned', 'schema_newer', 'not_found', 'conflict', 'capacity_unavailable'] satisfies ErrorCode[])('preserves unexpected storage %s without retry or fake refusal', async code => {
  const error = new StorageError(code); const updateRuntime = vi.fn().mockRejectedValue(error);
  await expect(createRuntimePublisher({ updateRuntime })(value())).rejects.toBe(error);
  expect(updateRuntime).toHaveBeenCalledTimes(1);
});
it('does not classify an arbitrary error merely by its code property', async () => {
  const error = { code: 'invalid_value' }; const updateRuntime = vi.fn().mockRejectedValue(error);
  await expect(createRuntimePublisher({ updateRuntime })(value())).rejects.toBe(error);
});

it('does not invent successful publication from an invalid original acknowledgement', async () => {
  const updateRuntime = vi.fn().mockResolvedValue(undefined);
  await expect(createRuntimePublisher({ updateRuntime })(value())).rejects.toThrow('Invalid runtime publication acknowledgement');
  expect(updateRuntime).toHaveBeenCalledTimes(1);
});
