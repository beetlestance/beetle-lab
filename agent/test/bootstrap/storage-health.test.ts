import { expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import { fixture } from './fixtures.js';

const f = fixture();
it.each([true])('keeps private routes authenticated when journal fails; observer throws: %s', async (throws) => {
  const e = await f.setup();
  const trigger = join(dirname(e.journalPath), 'kill-worker');
  const entry = join(dirname(e.journalPath), 'fault.mjs');
  await writeFile(
    entry,
    `import {existsSync} from 'node:fs';
    setInterval(()=>{if(existsSync(${JSON.stringify(trigger)}))process.exit(17)},10);
    await import(${JSON.stringify(e.options.journal.workerUrl?.href)});`,
  );
  const failure = vi.fn(() => {
    if (throws) throw Error('PRIVATE-CANARY');
  });
  const runtime = f.keep(
    await openAgentRuntime({
      ...e.options,
      onStorageFailure: failure,
      journal: { ...e.options.journal, workerUrl: pathToFileURL(entry) },
    }),
  );
  try {
    const healthy = await runtime.server.inject({ url: '/healthz' });
    expect(healthy.statusCode).toBe(200);
    expect(healthy.json()).toEqual({ status: 'ok', storage: 'ready' });
    expect((await runtime.server.inject({ url: '/healthz', method: 'HEAD' })).body).toBe('');
    expect((await runtime.server.inject({ url: '/runner/v1/capabilities' })).statusCode).toBe(401);
    expect((await runtime.server.inject({ url: '/healthz', method: 'POST' })).statusCode).toBe(401);
    await writeFile(trigger, 'synthetic');
    await vi.waitFor(() => expect(failure).toHaveBeenCalledTimes(1));
    const failed = await runtime.server.inject({ url: '/healthz' });
    expect(failed.statusCode).toBe(503);
    expect(failed.json()).toEqual({ status: 'unavailable', storage: 'unavailable' });
    expect(failed.body).not.toContain(e.journalPath);
  } finally {
    await expect(runtime.close()).rejects.toBeDefined();
  }
});
