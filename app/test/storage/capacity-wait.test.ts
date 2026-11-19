import { describe, expect, it } from 'vitest';
import { CapacityWait } from '../../src/adapters/outbound/sqlite/capacity-wait.js';
import { StorageError } from '../../src/adapters/outbound/sqlite/protocol.js';
import { observation, scope, seed, storageFixture } from './fixture.js';

const fixture = storageFixture();
describe('bridging a lapsed capacity observation', () => {
  it('answers a settings read once the next observation is accepted, instead of 503', async () => {
    const metadata = await fixture.open(undefined, { runtime: null }); await seed(metadata);
    const read = metadata.getSettings(scope);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(await metadata.updateRuntime(observation())).toBeNull();
    expect((await read).effective.runDefaults.budget.cpuMillis.value).toBe(100);
  });
  it('still refuses after the bounded wait when no observation arrives', async () => {
    const wait = new CapacityWait(20); let attempts = 0;
    await expect(wait.retry(async () => { attempts++; throw new StorageError('capacity_unavailable'); }))
      .rejects.toMatchObject({ code: 'capacity_unavailable' });
    expect(attempts).toBe(1);
  });
  it('retries only a capacity refusal, and only once', async () => {
    const wait = new CapacityWait(1000); let attempts = 0;
    await expect(wait.retry(async () => { attempts++; throw new StorageError('conflict'); }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(attempts).toBe(1);
    attempts = 0;
    const refused = wait.retry(async () => { attempts++; throw new StorageError('capacity_unavailable'); });
    await new Promise((resolve) => setTimeout(resolve, 10)); wait.accepted();
    await expect(refused).rejects.toMatchObject({ code: 'capacity_unavailable' });
    expect(attempts).toBe(2);
  });
});
