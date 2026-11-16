import * as staging from '../../src/staging/index.js';
import * as installation from '../../src/installation/index.js';
import { expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import * as transport from '../../src/transport/index.js';
import * as transfer from '../../src/output-transfer/index.js';
import * as collection from '../../src/collection/output/index.js';
import * as journals from '../../src/journal/index.js';
import { fixture } from './fixtures.js';
import { deferred } from '../supervisor/fixtures.js';
import { scope } from '../admission/fixtures.js';

const f = fixture();
it('binds one actual source reader to the same Journal/native range owner and drains server before Journal close', async () => {
  const e = await f.setup(); const factory = vi.spyOn(transfer, 'createOutputSourceReader'); const server = vi.spyOn(transport, 'createAgentServer');
  const opening = vi.spyOn(journals, 'openJournal');
  const stages = vi.spyOn(staging, 'Stager'); const controllers = vi.spyOn(installation, 'createInstallationController');
  try {
    const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true });
    expect(factory).toHaveBeenCalledTimes(1); expect(server).toHaveBeenCalledTimes(1); expect(opening).toHaveBeenCalledTimes(1);
    const journal = await opening.mock.results[0]!.value; const options = factory.mock.calls[0]![0];
    expect(controllers.mock.calls[0]![0].gate).toBe(options.gate);
    for (const [stage] of stages.mock.calls) expect(stage.gate).toBe(options.gate);
    expect(options.journal).toBe(journal); expect(options.readRange).toBe(collection.readOutputRange);
    expect(server.mock.calls[0]![0].outputs).toBe(factory.mock.results[0]!.value);
    const outputs = server.mock.calls[0]![0].outputs!; expect(Object.isFrozen(outputs)).toBe(true);
    const read = vi.spyOn(journal, 'readOutputSource'); const key = scope(e.offer);
    await expect(outputs.source(key, { deadline: performance.now() + 5000 })).rejects.toMatchObject({ code: 'not_found' });
    expect(read).not.toHaveBeenCalled(); expect(e.daemon.mutations()).toHaveLength(0);
    const entered = deferred<void>(); const release = deferred<void>();
    runtime.server.addHook('preClose', async () => { entered.resolve(); await release.promise; }); await runtime.server.ready();
    const closeJournal = vi.spyOn(journal, 'close'); const closing = runtime.close(); let closed = false; void closing.then(() => { closed = true; });
    try { await entered.promise; expect(closeJournal).not.toHaveBeenCalled(); expect(closed).toBe(false); }
    finally { release.resolve(); await closing; }
    expect(closeJournal).toHaveBeenCalledTimes(1); expect(e.daemon.mutations()).toHaveLength(0);
  } finally { vi.restoreAllMocks(); }
});
