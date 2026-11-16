import { chmod, realpath } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import * as sqlite from '../../src/adapters/outbound/sqlite/index.js';
import { openApplication } from '../../src/bootstrap/api.js';
import { initializeBackendRecovery, openBackendRecovery } from '../../src/bootstrap/recovery-control/index.js';
import { settingsFixture, storageFixture } from '../storage/fixture.js';
const f = storageFixture(); afterEach(() => {vi.restoreAllMocks();});
function deferred() {let resolve!: () => void; const promise = new Promise<void>(done => {resolve = done;}); return {promise, resolve};}
it('keeps offline exclusion through the original metadata close, not just the close request', async () => {
  const path = f.path(); const root = await realpath(dirname(path)); await chmod(root, 0o700);
  const installation = settingsFixture().chain.installation; const control = join(root, 'recovery-control.sqlite');
  initializeBackendRecovery(control, installation.id);
  const original = sqlite.openMetadata; const issued = deferred(); const closeGate = deferred();
  vi.spyOn(sqlite, 'openMetadata').mockImplementation(async options => {
    const metadata = await original(options);
    const close = metadata.close.bind(metadata);
    vi.spyOn(metadata, 'close').mockImplementation(async () => {issued.resolve(); await closeGate.promise; await close();});
    return metadata;
  });
  const app = await openApplication({externalOrigin: 'http://127.0.0.1:4311', recoveryControl: {path: control, installationId: installation.id},
    metadata: {path, workerUrl: f.workerUrl(), installation, runtime: null}});
  const closing = app.close();
  try {await issued.promise; expect(() => openBackendRecovery(control, installation.id)).toThrow('owned');}
  finally {closeGate.resolve(); await closing;}
  openBackendRecovery(control, installation.id).close();
});
