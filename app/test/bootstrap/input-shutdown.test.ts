import { afterEach, expect, it, vi } from 'vitest';
import type { InputService } from '../../src/ports/input-service.js';
import { openApplication } from '../../src/bootstrap/api.js';
import { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import { storageFixture, settingsFixture } from '../storage/fixture.js';

const runtime = vi.hoisted(() => ({ close: vi.fn<() => Promise<void>>() }));
vi.mock('../../src/bootstrap/input-runtime.js', () => ({
  openInputRuntime: async () => {
    const unexpected = async (): Promise<never> => { throw new Error('Unexpected input operation'); };
    const inputs: InputService = { control: unexpected, append: unexpected, read: unexpected,
      get: unexpected, list: unexpected, recover: unexpected, close: unexpected };
    return { inputs, recoveryState: () => 'failed' as const, close: runtime.close };
  },
}));
const fixture = storageFixture();
afterEach(() => { vi.restoreAllMocks(); runtime.close.mockReset(); });

/** Composition failure oracle; this intentionally substitutes only the runtime owner. */
it.each(['application', 'server'] as const)('%s close waits for failed runtime drainage, then closes metadata and reports failure', async entry => {
  let release!: () => void;
  const held = new Promise<void>(resolve => { release = resolve; });
  const error = new Error('Synthetic recovery failure');
  runtime.close.mockImplementation(async () => { await held; throw error; });
  const metadataClose = vi.spyOn(Metadata.prototype, 'close');
  const app = await openApplication({ externalOrigin: 'http://localhost:4310', inputsDirectory: '/synthetic-owned-root',
    metadata: { path: fixture.path(), workerUrl: fixture.workerUrl(), installation: settingsFixture().chain.installation, runtime: null } });
  let done = false;
  const closing = (entry === 'application' ? app.close() : app.server.close()).catch((failure: unknown) => {
    done = true; return failure;
  });
  try {
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(done).toBe(false); expect(metadataClose).not.toHaveBeenCalled();
    release(); expect(await closing).toBe(error);
    expect(metadataClose).toHaveBeenCalledTimes(1);
    await expect(metadataClose.mock.results[0]!.value).resolves.toBeUndefined();
    const again = app.close(); expect(app.close()).toBe(again); await again.catch(() => undefined);
  } finally { release(); await closing; }
});
