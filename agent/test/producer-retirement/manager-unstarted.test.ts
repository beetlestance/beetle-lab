import { expect, it, vi, afterEach } from 'vitest';
import { Manager } from '../../src/installation/manager.js';
import { createEntry, identity } from '../../src/installation/entry.js';
import type { Entry } from '../../src/installation/entry.js';
import { Supervisor } from '../../src/supervisor/index.js';
import { retirementFixture } from '../retirement/fixtures.js';
import { gateFor } from '../producer-gate/fixtures.js';
import { deferred } from '../output-transfer/fixtures.js';
import { operation } from '../staging/fixtures.js';
const f = retirementFixture(); const managers: Manager[] = [];
afterEach(async () => { await Promise.allSettled(managers.splice(0).map(manager => manager.close())); });
async function ready() {
  const v = await f.ready(); const intent = await v.journal.retirements.begin(v.request);
  const gate = gateFor(v.journal, intent.namespaceIdentity); const trap = vi.fn((): never => { throw new Error('unexpected native/catalogue effect'); });
  const supervisor = new Supervisor({ journal: v.journal, installationId: '00000000-0000-4000-8000-000000000010', backendFactory: trap });
  const manager = new Manager({ gate, journal: v.journal, supervisor,
    catalog: { engines: [], preflight: trap, preflightExport: trap, resolve: trap }, stagerFor: trap,
    guard: { watch: trap }, timeout: { watch: trap } }); managers.push(manager);
  const entries = Reflect.get(manager, 'entries') as Map<string, Entry>;
  return { ...v, intent, gate, trap, supervisor, manager, entries };
}
it('uses positive released never-started evidence without creating an empty entry or actor', async () => {
  const e = await ready(); await e.manager.retireOutput(e.intent, operation());
  expect(e.entries.size).toBe(0); expect(e.supervisor.size).toBe(0); expect(e.trap).not.toHaveBeenCalled();
  expect(await e.journal.readOutputAbsence(e.key)).toEqual(e.proof);
});
it('drains the actual held cached watch close before returning the existing-owner barrier', async () => {
  const e = await ready(); const entry = createEntry(e.key); const entered = deferred<void>(); const release = deferred<void>();
  const close = vi.fn(() => { entered.resolve(); return release.promise; });
  entry.watch = { initial: Promise.resolve({ ready: true }), status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close };
  e.entries.set(identity(e.key), entry); let done = false; const retiring = e.manager.retireOutput(e.intent, operation()).then(() => { done = true; });
  try { await entered.promise; expect(done).toBe(false); expect(entry.retiring).toBe(true);
    release.resolve(); await retiring; await e.manager.retireOutput(e.intent, operation()); expect(close).toHaveBeenCalledTimes(1);
    expect(e.trap).not.toHaveBeenCalled();
  } finally { release.resolve(); await retiring; }
});
it('retains a failed original close and refuses a forged intent before fencing actual owners', async () => {
  const e = await ready(); const entry = createEntry(e.key); const close = vi.fn(async () => { throw new Error('synthetic failed close'); });
  entry.watch = { initial: Promise.resolve({ ready: true }), status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close };
  e.entries.set(identity(e.key), entry);
  await expect(e.manager.retireOutput({ ...e.intent, namespaceIdentity: 'f'.repeat(64) }, operation())).rejects.toMatchObject({ reason: 'cleanup' });
  expect(entry.retiring).toBe(false); expect(close).not.toHaveBeenCalled();
  await expect(e.manager.retireOutput(e.intent, operation())).rejects.toMatchObject({ reason: 'cleanup' });
  await expect(e.manager.retireOutput(e.intent, operation())).rejects.toMatchObject({ reason: 'cleanup' });
  expect(e.entries.get(identity(e.key))).toBe(entry); expect(close).toHaveBeenCalledTimes(1);
});
it('does not dispatch allocation after an original get settles beyond its closed budget', async () => {
  const e = await ready(); const entered = deferred<void>(); const release = deferred<void>(); const abort = new AbortController();
  const get = e.journal.get.bind(e.journal); const read = vi.spyOn(e.journal, 'get').mockImplementationOnce(async key => {
    const value = await get(key); entered.resolve(); await release.promise; return value;
  });
  const allocation = vi.spyOn(e.journal, 'admission');
  const work = e.manager.retireOutput(e.intent, { ...operation(), signal: abort.signal }); void work.catch(() => undefined);
  try {
    await entered.promise; abort.abort(); release.resolve(); await expect(work).rejects.toMatchObject({ reason: 'closed' });
    expect(allocation).not.toHaveBeenCalled();
  } finally { release.resolve(); await Promise.allSettled([work]); read.mockRestore(); }
});
