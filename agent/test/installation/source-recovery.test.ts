import { expect, it, vi } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { createInstallationController } from '../../src/installation/index.js';
import { drive } from '../../src/installation/drive.js';
import type { DriveContext } from '../../src/installation/drive.js';
import { checkBudget } from '../../src/installation/budget.js';
import { createEntry } from '../../src/installation/entry.js';
import { JournalError } from '../../src/journal/index.js';
import type { Journal } from '../../src/journal/index.js';
import { Supervisor } from '../../src/supervisor/index.js';
import { createAttemptController } from '../../src/controller/index.js';
import { receiptForOutputSource } from '../../src/output-source/index.js';
import { operation, makePlan } from '../backends/docker/fixtures.js';
import { sourceFixture, inspect, hash } from '../source-journal/fixtures.js';

const f = sourceFixture();
function trapped(journal: Journal) {
  const trap = () => { throw new Error('unexpected native/catalogue/staging access'); };
  const catalog = { engines: [], preflightExport: vi.fn(trap), preflight: vi.fn(trap), resolve: vi.fn(trap) };
  const backendFactory = vi.fn(trap);
  const supervisor = new Supervisor({ journal, backendFactory, installationId: '00000000-0000-4000-8000-000000000010' });
  const actor = vi.spyOn(supervisor, 'actor').mockImplementation(trap); const retireActor = vi.spyOn(supervisor, 'retire').mockImplementation(trap);
  const stagerFor = vi.fn(trap); const outputWatch = vi.fn(trap); const timeoutWatch = vi.fn(trap);
  const options = { journal, catalog, supervisor, stagerFor, guard: { watch: outputWatch }, timeout: { watch: timeoutWatch } };
  const retire = vi.fn(async () => undefined);
  const context: DriveContext = { options, now: () => 100_010,
    guard: vi.fn((_entry, budget) => checkBudget(budget)), acquireStage: vi.fn(trap), releaseStage: vi.fn(trap),
    retire, stopGuard: vi.fn(trap), stopTimeout: vi.fn(trap) };
  const effects = [catalog.preflight, catalog.resolve, actor, retireActor, stagerFor, outputWatch, timeoutWatch, backendFactory,
    context.acquireStage, context.releaseStage, context.stopGuard, context.stopTimeout];
  return { context, options, retire, catalog, effects };
}
function noEffects(value: ReturnType<typeof trapped>): void { for (const effect of value.effects) expect(effect).not.toHaveBeenCalled(); }
function sourceRows(path: string) {
  return inspect(path).rows.filter(value => ['accepted_attempts', 'reservations', 'journal_authority', 'disk_holds',
    'disk_retention_stats', 'output_collection_intents', 'output_sources'].includes(value.table));
}

// Source facts are synthetic metadata; actual compiled Journal/SQLite establishes durable custody only.
it('actual installation drive releases a committed source before current catalogue, Offer, staging or native recovery and repeats after owner recreation', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); await e.journal.commitOutputSource(e.collected);
  const t = trapped(e.journal); const offer = vi.spyOn(e.journal, 'readOffer'); const intent = vi.spyOn(e.journal, 'readOutputCollection');
  const release = vi.spyOn(e.journal, 'releaseOutputSource'); const admission = vi.spyOn(e.journal, 'admission');
  const receipt = receiptForOutputSource(e.source, hash);
  for (let owner = 0; owner < 2; owner++) {
    const manager = createInstallationController(t.options);
    try { expect(await manager.drive(e.key, operation(5000))).toEqual({ kind: 'released', collection: 'finished' }); }
    finally { await manager.close(); }
  }
  expect(release.mock.calls).toEqual([[receipt], [receipt]]);
  expect(offer).not.toHaveBeenCalled(); expect(intent).not.toHaveBeenCalled(); expect(admission).not.toHaveBeenCalled(); noEffects(t);
  await f.close(e.journal);
  const native = sourceRows(e.path);
  expect(native.find(value => value.table === 'reservations')?.rows[0]?.charged).toBe(0);
  expect(native.find(value => value.table === 'disk_holds')?.rows[0]?.phase).toBe('retained');
  expect(native.find(value => value.table === 'output_collection_intents')?.rows[0]?.phase).toBe('sourced');
});
it.each(['source', 'intent', 'release'] as const)('maps %s queue_full to journal_busy without catalogue, execution or premature retirement', async kind => {
  const e = await f.seed(); const t = trapped(e.journal); const calls: string[] = [];
  const source = vi.spyOn(e.journal, 'readOutputSource').mockImplementation(async () => {
    calls.push('source'); if (kind === 'source') throw new JournalError('queue_full'); return kind === 'release' ? e.source : null;
  });
  const intent = vi.spyOn(e.journal, 'readOutputCollection').mockImplementation(async () => { calls.push('intent'); throw new JournalError('queue_full'); });
  const release = vi.spyOn(e.journal, 'releaseOutputSource').mockImplementation(async () => { calls.push('release'); throw new JournalError('queue_full'); });
  expect(await drive(t.context, createEntry(e.key), operation(5000))).toEqual({ kind: 'deferred', reason: 'journal_busy' });
  expect(calls).toEqual(kind === 'source' ? ['source'] : ['source', kind]);
  expect(t.retire).not.toHaveBeenCalled(); noEffects(t);
  source.mockRestore(); intent.mockRestore(); release.mockRestore();
  expect(await e.journal.admission({ kind: 'reservation', key: e.key })).toMatchObject({ status: 'charged' });
});
it.each(['source', 'intent', 'release'] as const)('preserves unknown %s failure and original charge without entering catalogue recovery', async kind => {
  const e = await f.seed(); const t = trapped(e.journal);
  const source = vi.spyOn(e.journal, 'readOutputSource').mockImplementation(async () => {
    if (kind === 'source') throw new JournalError('unavailable'); return kind === 'release' ? e.source : null;
  });
  const intent = vi.spyOn(e.journal, 'readOutputCollection').mockRejectedValue(new JournalError('unavailable'));
  const release = vi.spyOn(e.journal, 'releaseOutputSource').mockRejectedValue(new JournalError('unavailable'));
  await expect(drive(t.context, createEntry(e.key), operation(5000))).rejects.toMatchObject({ code: 'unavailable' });
  expect(t.retire).not.toHaveBeenCalled(); noEffects(t);
  source.mockRestore(); intent.mockRestore(); release.mockRestore();
  expect(await e.journal.admission({ kind: 'reservation', key: e.key })).toMatchObject({ status: 'charged' });
});
it('holds source/read intent originals before Offer/catalogue and treats neither pending read as absence', async () => {
  const e = await f.seed(); const t = trapped(e.journal); let sourceDone!: (value: null) => void; let intentFail!: (reason: Error) => void;
  const source = vi.spyOn(e.journal, 'readOutputSource').mockImplementation(() => new Promise(resolve => { sourceDone = resolve; }));
  const intent = vi.spyOn(e.journal, 'readOutputCollection').mockImplementation(() => new Promise((_resolve, reject) => { intentFail = reject; }));
  const offer = vi.spyOn(e.journal, 'readOffer'); const pending = drive(t.context, createEntry(e.key), operation(5000));
  await vi.waitFor(() => expect(source).toHaveBeenCalledTimes(1)); expect(intent).not.toHaveBeenCalled();
  expect(offer).not.toHaveBeenCalled(); expect(t.retire).not.toHaveBeenCalled(); noEffects(t);
  sourceDone(null); await vi.waitFor(() => expect(intent).toHaveBeenCalledTimes(1));
  expect(offer).not.toHaveBeenCalled(); expect(t.retire).not.toHaveBeenCalled(); noEffects(t);
  intentFail(new JournalError('unavailable')); await expect(pending).rejects.toMatchObject({ code: 'unavailable' });
  source.mockRestore(); intent.mockRestore();
});
it('refuses malformed returned source before issuing receipt release or retiring the owner', async () => {
  const e = await f.seed(); const t = trapped(e.journal); const damaged = structuredClone(e.source); Reflect.set(damaged.root, 'directory', '/changed');
  const source = vi.spyOn(e.journal, 'readOutputSource').mockResolvedValue(damaged); const release = vi.spyOn(e.journal, 'releaseOutputSource');
  await expect(drive(t.context, createEntry(e.key), operation(5000))).rejects.toMatchObject({ code: 'integrity' });
  expect(release).not.toHaveBeenCalled(); expect(t.retire).not.toHaveBeenCalled(); noEffects(t); source.mockRestore();
});
it('reads durable pending intent before Offer/catalogue and leaves mismatched original profile charged without retiring', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); const t = trapped(e.journal); const calls: string[] = [];
  const readSource = e.journal.readOutputSource.bind(e.journal); const readIntent = e.journal.readOutputCollection.bind(e.journal);
  const readOffer = e.journal.readOffer.bind(e.journal); const allocation = e.journal.admission.bind(e.journal);
  vi.spyOn(e.journal, 'readOutputSource').mockImplementation(key => { calls.push('source'); return readSource(key); });
  vi.spyOn(e.journal, 'readOutputCollection').mockImplementation(key => { calls.push('intent'); return readIntent(key); });
  vi.spyOn(e.journal, 'readOffer').mockImplementation(key => { calls.push('offer'); return readOffer(key); });
  vi.spyOn(e.journal, 'admission').mockImplementation(command => { calls.push(command.kind); return allocation(command); });
  t.catalog.resolve.mockImplementation(() => { calls.push('catalogue'); throw new Error('original profile unavailable'); });
  const before = await allocation({ kind: 'reservation', key: e.key });
  await expect(drive(t.context, createEntry(e.key), operation(5000))).rejects.toMatchObject({ reason: 'catalog' });
  expect(calls).toEqual(['source', 'intent', 'offer', 'reservation', 'catalogue']);
  expect(t.retire).not.toHaveBeenCalled(); expect(t.context.acquireStage).not.toHaveBeenCalled();
  expect(await allocation({ kind: 'reservation', key: e.key })).toEqual(before);
});
it('never restages, admits or aborts when a pending intent lacks its claimed reservation', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); const t = trapped(e.journal);
  const original = await e.journal.admission({ kind: 'reservation', key: e.key });
  if (!('status' in original)) throw new Error('Missing synthetic reservation');
  const admission = vi.spyOn(e.journal, 'admission').mockResolvedValue({ ...original, createToken: null });
  await expect(drive(t.context, createEntry(e.key), operation(5000))).rejects.toMatchObject({ reason: 'journal' });
  expect(admission.mock.calls.map(([command]) => command.kind)).toEqual(['reservation']);
  expect(t.retire).not.toHaveBeenCalled(); noEffects(t); admission.mockRestore();
});
it.each(['charged', 'different-evidence'] as const)('refuses %s release replies before retiring a source owner', async kind => {
  const e = await f.seed(); const t = trapped(e.journal); const original = await e.journal.admission({ kind: 'reservation', key: e.key });
  if (!('status' in original)) throw new Error('Missing synthetic reservation');
  const source = vi.spyOn(e.journal, 'readOutputSource').mockResolvedValue(e.source);
  const release = vi.spyOn(e.journal, 'releaseOutputSource').mockResolvedValue(kind === 'charged' ? original
    : { ...original, status: 'released', releaseEvidence: e.failed.evidence });
  await expect(drive(t.context, createEntry(e.key), operation(5000))).rejects.toMatchObject({ reason: 'journal' });
  expect(t.retire).not.toHaveBeenCalled(); noEffects(t); source.mockRestore(); release.mockRestore();
});
it('continues historical no-source released handling without catalogue access or source backfill', async () => {
  const e = await f.seed(); await e.journal.admission({ kind: 'release', evidence: e.failed.evidence }); const t = trapped(e.journal);
  const begin = vi.spyOn(e.journal, 'beginOutputCollection'); const commit = vi.spyOn(e.journal, 'commitOutputSource');
  expect(await drive(t.context, createEntry(e.key), operation(5000))).toEqual({ kind: 'released', collection: 'failed' });
  expect(t.retire).toHaveBeenCalledTimes(1); noEffects(t); expect(begin).not.toHaveBeenCalled(); expect(commit).not.toHaveBeenCalled();
});
it('leaves an existing live controller on its original ownership path', async () => {
  const e = await f.seed(); const t = trapped(e.journal); const entry = createEntry(e.key);
  const source = vi.spyOn(e.journal, 'readOutputSource'); const intent = vi.spyOn(e.journal, 'readOutputCollection');
  entry.plan = makePlan(); entry.timeout = { status: () => ({ ready: true, closed: false, stopRequested: false, reason: null }), close: async () => undefined };
  entry.watch = { initial: Promise.resolve({ ready: true }), status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }), close: async () => undefined };
  entry.controller = createAttemptController({ journal: e.journal, supervisor: t.options.supervisor, input: { key: e.key, plan: entry.plan },
    collectOutputs: () => { throw new Error('no collection'); }, wallNow: () => 100_010 });
  const tick = vi.spyOn(entry.controller, 'tick').mockResolvedValue({ kind: 'awaiting_collection', reason: 'busy' });
  const launch = vi.spyOn(entry.controller, 'launch');
  try {
    expect(await drive(t.context, entry, operation(5000))).toEqual({ kind: 'awaiting_collection', reason: 'busy' });
    expect(source).not.toHaveBeenCalled(); expect(intent).not.toHaveBeenCalled(); expect(tick).toHaveBeenCalledTimes(1);
    expect(launch).not.toHaveBeenCalled(); noEffects(t);
  } finally {
    await e.journal.admission({ kind: 'release', evidence: e.failed.evidence }); await entry.controller.close();
  }
});
it('replays exact durable source release after withholding the actual release COMMIT reply and reopening', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); await e.journal.commitOutputSource(e.collected);
  const t = trapped(e.journal); const receive = Reflect.get(e.journal, 'receive') as (reply: unknown) => void;
  let observed!: () => void; const committed = new Promise<void>(resolve => { observed = resolve; });
  Reflect.set(e.journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && Reflect.get(reply, 'ok') === true) {
      const value = Reflect.get(reply, 'value');
      if (value && typeof value === 'object' && Reflect.get(value, 'status') === 'released') { observed(); return; }
    }
    receive.call(e.journal, reply);
  });
  let settled = false; const pending = drive(t.context, createEntry(e.key), operation(5000));
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const rejected = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
  await committed; expect(settled).toBe(false); expect(t.retire).not.toHaveBeenCalled(); noEffects(t);
  await e.journal.abort(); await rejected; const before = sourceRows(e.path);
  expect(before.find(value => value.table === 'reservations')?.rows[0]?.charged).toBe(0);
  const reopened = await f.open(e.path); const next = trapped(reopened); const release = vi.spyOn(reopened, 'releaseOutputSource');
  const manager = createInstallationController(next.options);
  try { expect(await manager.drive(e.key, operation(5000))).toEqual({ kind: 'released', collection: 'finished' }); }
  finally { await manager.close(); }
  expect(release.mock.calls).toEqual([[receiptForOutputSource(e.source, hash)]]); noEffects(next);
  const closure = await reopened.readOutputDelivery(e.key); expect(closure?.receipt).toEqual(receiptForOutputSource(e.source, hash));
  const parent = before.find(value => value.table === 'accepted_attempts')!.rows[0]!;
  expect(closure?.finalAgentSeq).toBe(parent.last_seq);
  parent.delivery_bytes = Buffer.byteLength(encodeCanonicalJson(closure, 1024)) + 256; parent.delivery_pending = 0;
  await f.close(reopened); expect(sourceRows(e.path)).toEqual(before);
});
