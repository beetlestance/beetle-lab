import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openApplication } from '../../src/bootstrap/api.js';
import { observation, settingsFixture, storageFixture } from '../storage/fixture.js';

const f = storageFixture();
it.each([false, true])('reports real worker failure even if observer throws: %s', async (throws) => {
  const trigger = join(f.root(), 'kill-worker');
  const entry = join(f.root(), 'fault.mjs');
  await writeFile(
    entry,
    `import {existsSync} from 'node:fs';
    setInterval(()=>{if(existsSync(${JSON.stringify(trigger)}))process.exit(17)},10);
    await import(${JSON.stringify(f.workerUrl().href)});`,
  );
  const setup = settingsFixture();
  const failure = vi.fn(() => {
    if (throws) throw Error('PRIVATE-CANARY');
  });
  const app = await openApplication({
    externalOrigin: 'http://127.0.0.1:43179',
    onStorageFailure: failure,
    metadata: {
      path: f.path(),
      workerUrl: pathToFileURL(entry),
      installation: setup.chain.installation,
      runtime: observation(setup.runtime),
    },
  });
  try {
    const healthy = await app.server.inject({ url: '/healthz' });
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json()).toEqual({ status: 'ok', storage: 'ready' });
    expect(healthy.headers['cache-control']).toBe('no-store');
    expect((await app.server.inject({ url: '/healthz', method: 'HEAD' })).body).toBe('');
    const ready = await app.server.inject({ url: '/health/ready' });
    expect([ready.statusCode, ready.json(), ready.headers['cache-control']]).toEqual([
      200,
      { status: 'ready', reason: null },
      'no-store',
    ]);
    await writeFile(trigger, 'synthetic');
    await vi.waitFor(() => expect(failure).toHaveBeenCalledTimes(1));
    const failed = await app.server.inject({ url: '/healthz' });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: 'unavailable', storage: 'unavailable' });
    expect(failed.body).not.toContain(f.root());
    const notReady = await app.server.inject({ url: '/health/ready' });
    expect([notReady.statusCode, notReady.json()]).toEqual([503, { status: 'not_ready', reason: 'unavailable' }]);
  } finally {
    await expect(app.close()).rejects.toMatchObject({ code: 'unavailable' });
  }
});
