import { expect, it, vi } from 'vitest';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import * as transfer from '../../src/output-transfer/index.js';
import * as journals from '../../src/journal/index.js';
import { fixture } from './fixtures.js';
import { scope } from '../admission/fixtures.js';
const f = fixture();
it('keeps runtime and Journal ownership when an actual shared gate has an unresolved original close', async () => {
  const e = await f.setup(); const readers = vi.spyOn(transfer, 'createOutputSourceReader'); const opening = vi.spyOn(journals, 'openJournal');
  try {
    const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
    const journal = await opening.mock.results[0]!.value; const gate = readers.mock.calls[0]![0].gate;
    // Synthetic custody failure, no kernel handle is issued by this fixture.
    const lease = gate.acquire(scope(e.offer)); lease.issue(() => ({ close: 'unknown' })); lease.poison();
    const close = vi.spyOn(journal, 'close'); await expect(runtime.close()).rejects.toMatchObject({ reason: 'cleanup' });
    expect(close).not.toHaveBeenCalled(); expect(gate.status().leases).toBe(1);
    await expect(openAgentRuntime(e.options)).rejects.toMatchObject({ reason: 'busy' });
  } finally { vi.restoreAllMocks(); }
});
