import { DatabaseSync } from 'node:sqlite';
import { expect, it, vi } from 'vitest';
import { JournalError } from '../../src/journal/index.js';
import type { Journal } from '../../src/journal/index.js';
import { fixture, budget } from './fixtures.js';
import { deferred, reserved } from '../supervisor/fixtures.js';

const f = fixture();
async function stopped(e: Awaited<ReturnType<typeof f.setupController>>) {
  await e.controller.launch(budget()); e.time.advance(1); e.backend.observation = e.backend.known('exited').value;
}
function native(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    return { rows: db.prepare('SELECT collection_bytes,source_bytes,spool_bytes,snapshot_bytes,checkpoint_bytes,hold_bytes FROM accepted_attempts').all(),
      intents: db.prepare('SELECT collection_id,phase,charged_bytes FROM output_collection_intents').all(),
      sources: db.prepare('SELECT manifest_digest,source_digest,charged_bytes FROM output_sources').all(),
      holds: db.prepare('SELECT * FROM disk_holds').all(), counters: db.prepare('SELECT * FROM disk_retention_stats').all(),
      foreignKeys: db.prepare('PRAGMA foreign_key_check').all() };
  } finally { db.close(); }
}
/** Holds the actual worker reply, leaving its original public call pending. */
function withheld(journal: Journal) {
  const observed = deferred<void>(); const receive = Reflect.get(journal, 'receive') as (reply: unknown) => void;
  let reply: unknown; let captured = false;
  function wrap<Input, Value>(issue: (input: Input) => Promise<Value>) {
    return (input: Input): Promise<Value> => {
      const id = Number(Reflect.get(journal, 'nextId')) + 1;
      Reflect.set(journal, 'receive', (value: unknown) => {
        if (value && typeof value === 'object' && Reflect.get(value, 'id') === id) {
          reply = value; captured = true; observed.resolve(); return;
        }
        receive.call(journal, value);
      });
      return issue(input);
    };
  }
  return { observed: observed.promise, wrap, deliver() {
    Reflect.set(journal, 'receive', receive);
    if (captured) { captured = false; receive.call(journal, reply); }
  } };
}
it('reads source then intent before actor work, and a failed source read cannot grant launch', async () => {
  const e = await f.setupController(); const order: string[] = [];
  const source = e.journal.readOutputSource.bind(e.journal); const intent = e.journal.readOutputCollection.bind(e.journal);
  const sourceSpy = vi.spyOn(e.journal, 'readOutputSource').mockImplementation(key => { order.push('source'); return source(key); });
  const intentSpy = vi.spyOn(e.journal, 'readOutputCollection').mockImplementation(key => { order.push('intent'); return intent(key); });
  const actor = vi.spyOn(e.manager, 'actor');
  try {
    sourceSpy.mockRejectedValueOnce(new JournalError('unavailable'));
    await expect(e.controller.launch(budget())).rejects.toMatchObject({ reason: 'journal' });
    expect(intentSpy).not.toHaveBeenCalled(); expect(actor).not.toHaveBeenCalled();
    await e.controller.tick(budget());
    expect(order.slice(0, 2)).toEqual(['source', 'intent']); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  } finally { sourceSpy.mockRestore(); intentSpy.mockRestore(); actor.mockRestore(); }
});
it.each(['begin', 'commit', 'release'] as const)('keeps a genuine held %s worker reply owned until delivery', async kind => {
  const e = await f.setupController(); await stopped(e);
  if (kind === 'release') await e.controller.tick(budget());
  const hold = withheld(e.journal);
  const spy = kind === 'begin'
    ? vi.spyOn(e.journal, 'beginOutputCollection').mockImplementationOnce(hold.wrap(e.journal.beginOutputCollection.bind(e.journal)))
    : kind === 'commit'
      ? vi.spyOn(e.journal, 'commitOutputSource').mockImplementationOnce(hold.wrap(e.journal.commitOutputSource.bind(e.journal)))
      : vi.spyOn(e.journal, 'releaseOutputSource').mockImplementationOnce(hold.wrap(e.journal.releaseOutputSource.bind(e.journal)));
  const work = e.controller.tick(budget()); let settled = false; void work.then(() => { settled = true; }, () => { settled = true; });
  try {
    await Promise.race([hold.observed, work.then(() => { throw new Error('Original reply was not held'); })]);
    expect(settled).toBe(false); await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'busy' });
    expect(await e.journal.readOutputCollection(e.key)).not.toBeNull();
    expect(e.collections).toHaveLength(kind === 'begin' ? 0 : 1);
    if (kind === 'release') expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('released');
    else expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
    hold.deliver();
    expect(await work).toEqual({ kind: kind === 'release' ? 'released' : 'awaiting_release', collection: 'finished' });
    expect(Object.isFrozen(spy.mock.calls[0]![0])).toBe(true);
    if (kind !== 'release') expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'finished' });
    expect(e.backend.starts).toBe(1);
  } finally { hold.deliver(); await work.catch(() => undefined); spy.mockRestore(); }
});
it('replays the same immutable intent after an applied begin loses its caller acknowledgement', async () => {
  const e = await f.setupController(); await stopped(e); const begin = e.journal.beginOutputCollection.bind(e.journal);
  const spy = vi.spyOn(e.journal, 'beginOutputCollection').mockImplementationOnce(async input => { await begin(input); throw new JournalError('unavailable'); });
  try {
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
    expect(e.collections).toHaveLength(0); const original = spy.mock.calls[0]![0]; e.time.advance(1);
    expect(await e.controller.tick(budget())).toEqual({ kind: 'awaiting_release', collection: 'finished' });
    expect(spy.mock.calls[1]![0]).toBe(original);
    expect((await e.journal.readOutputSource(e.key))?.release.runtime).toEqual(original.runtime);
  } finally { spy.mockRestore(); }
});
it.each(['commit', 'release'] as const)('reconciles an applied %s without recollecting or changing original evidence', async kind => {
  const e = await f.setupController(); await stopped(e);
  if (kind === 'release') await e.controller.tick(budget());
  const commit = e.journal.commitOutputSource.bind(e.journal); const release = e.journal.releaseOutputSource.bind(e.journal);
  const spy = kind === 'commit'
    ? vi.spyOn(e.journal, 'commitOutputSource').mockImplementationOnce(async input => { await commit(input); throw new JournalError('unavailable'); })
    : vi.spyOn(e.journal, 'releaseOutputSource').mockImplementationOnce(async input => { await release(input); throw new JournalError('unavailable'); });
  try {
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
    const source = await e.journal.readOutputSource(e.key); e.time.advance(10);
    expect(await e.controller.tick(budget())).toEqual({ kind: kind === 'commit' ? 'awaiting_release' : 'released', collection: 'finished' });
    if (kind === 'commit') expect(await e.controller.tick(budget())).toEqual({ kind: 'released', collection: 'finished' });
    else expect(spy.mock.calls[1]![0]).toBe(spy.mock.calls[0]![0]);
    expect(await e.journal.readOutputSource(e.key)).toEqual(source); expect(e.collections).toHaveLength(1);
    expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).releaseEvidence).toEqual(source!.release);
  } finally { spy.mockRestore(); }
});
it('retains the exact successful request across actual native source quota refusals', async () => {
  const sized = await f.setupController(); await stopped(sized); await sized.controller.tick(budget());
  await sized.controller.close(); await f.close(sized.journal);
  const measured = native(sized.journalPath).rows[0]!;
  const quota = ['collection_bytes', 'source_bytes', 'spool_bytes', 'snapshot_bytes', 'checkpoint_bytes', 'hold_bytes']
    .reduce((total, field) => total + Number(measured[field]), 0) - 1;
  const e = await f.setupController(quota); await stopped(e);
  const commit = vi.spyOn(e.journal, 'commitOutputSource'); const fail = vi.spyOn(e.journal, 'failOutputCollection');
  const admission = vi.spyOn(e.journal, 'admission');
  try {
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
    expect(commit).toHaveBeenCalledTimes(1); const original = commit.mock.calls[0]![0];
    await expect(commit.mock.results[0]!.value).rejects.toMatchObject({ code: 'quota_exceeded' });
    expect(await e.journal.readOutputSource(e.key)).toBeNull(); e.time.advance(5);
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'journal' });
    expect(commit).toHaveBeenCalledTimes(2); expect(commit.mock.calls[1]![0]).toBe(original);
    expect(e.collections).toHaveLength(1); expect(fail).not.toHaveBeenCalled();
    expect(admission.mock.calls.some(([input]) => input.kind === 'release')).toBe(false);
    expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  } finally { commit.mockRestore(); fail.mockRestore(); admission.mockRestore(); }
  await e.controller.close(); await f.close(e.journal);
  const facts = native(e.journalPath);
  expect(facts.intents).toMatchObject([{ phase: 'pending' }]); expect(facts.sources).toEqual([]); expect(facts.foreignKeys).toEqual([]);
  expect(facts.rows[0]!.source_bytes).toBe(0); expect(facts.holds).toMatchObject([{ phase: 'active' }]);
});
it('refuses source and release when the stopped control owner fails its original close', async () => {
  const e = await f.setupController(); await stopped(e); e.readers[0]!.closeFailure = true;
  const begin = vi.spyOn(e.journal, 'beginOutputCollection'); const commit = vi.spyOn(e.journal, 'commitOutputSource');
  try {
    await expect(e.controller.tick(budget())).rejects.toMatchObject({ reason: 'cleanup' });
    expect(begin).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled(); expect(e.collections).toHaveLength(0);
    expect(await e.journal.readOutputSource(e.key)).toBeNull();
    expect(reserved(await e.journal.admission({ kind: 'reservation', key: e.key })).status).toBe('charged');
  } finally { begin.mockRestore(); commit.mockRestore(); }
});
