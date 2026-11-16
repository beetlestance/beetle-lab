import { expect, it, vi } from 'vitest';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import { producerBarrierFacts } from '../../src/producer-retirement/index.js';
import * as journals from '../../src/journal/index.js';
import { fixture } from './fixtures.js';
import { observation, now, scope } from '../admission/fixtures.js';
import { requestFor } from '../producer-retirement/fixtures.js';
import { deferred } from '../output-transfer/fixtures.js';
const f = fixture();
async function ready() {
  const e = await f.setup(); const journal = await f.open(e.journalPath);
  const preflight = e.options.catalog.preflight(e.offer); const key = scope(preflight.offer);
  await journal.admission({ kind: 'configure', configuration: { ...e.options.configuration,
    profiles: e.options.catalog.engines.map(engine => engine.approved) } });
  const observed = observation(); observed.capacity.outputBytes = 131_072;
  await journal.admission({ kind: 'observe', observation: observed });
  await journal.admission({ kind: 'offer', offer: preflight.offer, validation: preflight.validation, now });
  const admission = await journal.admission({ kind: 'admit', key, now, sourceOrdinal: 1 });
  if (!('status' in admission)) throw new Error('Missing real admission');
  await journal.admission({ kind: 'abortUnstarted', key }); const proof = await journal.closeOutputAbsence(key);
  if (!proof) throw new Error('Missing actual closure');
  await journal.acknowledge({ protocolVersion: '1.0', ...key, throughSeq: proof.finalAgentSeq }); await f.close(journal);
  return { ...e, key, request: requestFor(proof) };
}
it('composes a real Journal/gate/installation barrier through the private runtime port without runtime effects', async () => {
  const e = await ready(); const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
  const work = runtime.retirement.retire(e.request); const result = await work.result; await work.settled;
  expect(result.ok).toBe(true); if (!result.ok) throw new Error('Missing barrier');
  expect(producerBarrierFacts(result.value).intent.request).toEqual(e.request); expect(e.daemon.mutations()).toHaveLength(0);
  await runtime.close(); expect(() => producerBarrierFacts(result.value)).toThrow('closed');
});
it('waits actual held preflight on shutdown before closing the gate or Journal and issues no late mutation', async () => {
  const e = await ready(); const opened = vi.spyOn(journals, 'openJournal');
  try {
    const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
    const journal = await opened.mock.results[0]!.value; const close = vi.spyOn(journal, 'close');
    const receive = Reflect.get(journal, 'receive') as (reply: unknown) => void; const held = deferred<unknown>();
    const id = Number(Reflect.get(journal, 'nextId')) + 1;
    Reflect.set(journal, 'receive', (reply: unknown) => {
      if (reply && typeof reply === 'object' && Reflect.get(reply, 'id') === id) { held.resolve(reply); return; }
      receive.call(journal, reply);
    });
    const work = runtime.retirement.retire(e.request); const reply = await held.promise; let closed = false;
    const closing = runtime.close().then(() => { closed = true; });
    expect(await work.result).toEqual({ ok: false, reason: 'closed' }); expect(closed).toBe(false); expect(close).not.toHaveBeenCalled();
    Reflect.set(journal, 'receive', receive); receive.call(journal, reply); await work.settled; await closing;
    expect(close).toHaveBeenCalledTimes(1); expect(e.daemon.mutations()).toHaveLength(0);
    const next = f.keep(await openAgentRuntime(e.options)); await next.initial; await next.close();
  } finally { vi.restoreAllMocks(); }
});
it('derives private never-started writer absence through the actual shared runtime owners without Docker mutations', async () => {
  const e = await ready(); const opened = vi.spyOn(journals, 'openJournal');
  try {
    const runtime = f.keep(await openAgentRuntime(e.options)); await runtime.initial;
    const journal = await opened.mock.results[0]!.value; const work = runtime.retirement.retire(e.request);
    const result = await work.result; await work.settled; if (!result.ok) throw new Error('Missing producer token');
    const absent = await runtime.retiredRuntime.retire(result.value, { deadline: performance.now() + 5000 });
    const { runtimeAbsentFacts } = await import('../../src/runtime-retirement/index.js');
    expect(runtimeAbsentFacts(absent, journal.retirements).runtime).toEqual({ kind: 'never_started' });
    expect(e.daemon.mutations()).toHaveLength(0); await runtime.close();
    expect(() => runtimeAbsentFacts(absent, journal.retirements)).toThrow('closed');
  } finally { vi.restoreAllMocks(); }
});
