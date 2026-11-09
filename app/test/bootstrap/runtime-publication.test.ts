import { expect, it, vi } from 'vitest';
import { createRuntimePublisher } from '../../src/bootstrap/runtime-publication.js';
import { StorageError } from '../../src/adapters/outbound/sqlite/index.js';
import type { ErrorCode } from '../../src/adapters/outbound/sqlite/index.js';
import { settingsFixture } from '../domain/fixtures.js';
import { RuntimeCapacity } from '../../src/adapters/outbound/sqlite/runtime.js';
import { SemanticError } from '../../src/domain/namespaces/index.js';
const value = () => ({ journalAuthority: '33333333-3333-4333-8333-333333333333', execution: { stagingBytes: 10485760, perRunStagingBytes: 2097152 }, ceilings: settingsFixture().runtime, observedAtMs: 100, expiresAtMs: 1100 });
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

it('refuses a nonnull update on actual cache clock rollback while acknowledging revocation', async () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(10000);
  try {
    const fixture = settingsFixture();
    const cache = new RuntimeCapacity({ installation: fixture.chain.installation,
      runtime: { journalAuthority: '33333333-3333-4333-8333-333333333333', execution: { stagingBytes: 10485760, perRunStagingBytes: 2097152 }, ceilings: fixture.runtime, observedAtMs: 10000, expiresAtMs: 11000 } });
    clock.mockReturnValue(10100); expect(cache.snapshot()).not.toBeNull();
    clock.mockReturnValue(10050);
    const publish = createRuntimePublisher({ updateRuntime: async fact => {
      try { return cache.update(fact); }
      catch (error) {
        // Metadata transports domain refusal codes as StorageError; the real worker case is tested separately.
        if (error instanceof SemanticError) throw new StorageError(error.code);
        throw error;
      }
    } });
    expect(await publish({ journalAuthority: '33333333-3333-4333-8333-333333333333', execution: { stagingBytes: 10485760, perRunStagingBytes: 2097152 }, ceilings: fixture.runtime, observedAtMs: 10050, expiresAtMs: 11050 })).toBe(false);
    expect(cache.snapshot()).toBeNull();
    expect(await publish(null)).toBe(true);
    clock.mockReturnValue(10101);
    expect(await publish({ journalAuthority: '33333333-3333-4333-8333-333333333333', execution: { stagingBytes: 10485760, perRunStagingBytes: 2097152 }, ceilings: fixture.runtime, observedAtMs: 10101, expiresAtMs: 11101 })).toBe(true);
  } finally { clock.mockRestore(); }
});
