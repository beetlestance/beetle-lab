import { expect, it, vi } from 'vitest';
import { Worker } from 'node:worker_threads';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { openMetadata } from '../../../src/adapters/outbound/sqlite/index.js';
import { settingsFixture } from '../fixture.js';
it('retains the failed worker termination original before rejecting an indexing call', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beetle-history-carrier-'));
  const file = join(root, 'held.mjs');
  await writeFile(file, "import {parentPort} from 'node:worker_threads';parentPort.postMessage({kind:'ready'});parentPort.on('message',()=>{});\n");
  const metadata = await openMetadata({ path: join(root, 'owned.sqlite'), workerUrl: pathToFileURL(file),
    installation: settingsFixture().chain.installation, runtime: null });
  let release!: () => void; const gate = new Promise<void>(resolve => { release = resolve; });
  const originalTerminate = Worker.prototype.terminate;
  const terminate = vi.spyOn(Worker.prototype, 'terminate').mockImplementation(function(this: Worker) {
    return originalTerminate.call(this).then(async exit => { await gate; return exit; });
  });
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  let settled = false;
  const pending = metadata.historySummaries.scan({ nowMs: Date.now(), limit: 1 }).finally(() => { settled = true; });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
  try {
    await vi.advanceTimersByTimeAsync(5000); expect(terminate).toHaveBeenCalledTimes(1); expect(settled).toBe(false);
    let stopped = false; const closing = metadata.abort().then(() => { stopped = true; });
    await Promise.resolve(); expect(stopped).toBe(false); release(); await rejected; await closing;
    expect(settled).toBe(true); expect(terminate).toHaveBeenCalledTimes(1);
  } finally {
    release(); vi.useRealTimers(); await metadata.abort(); terminate.mockRestore(); await rm(root, { recursive: true, force: true });
  }
});
