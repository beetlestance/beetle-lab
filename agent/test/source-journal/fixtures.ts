import { afterEach } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { sealEngineResult, encodeCanonicalJson } from '@beetle/contracts';
import type { ControlEvent, EngineResult, Offer } from '@beetle/contracts';
import { initialize } from '../../src/journal/schema.js';
import { Store } from '../../src/journal/store.js';
import type { Journal } from '../../src/journal/index.js';
import type { OutputSourceOperation, FailedOutputCollection } from '../../src/journal/output-source-protocol.js';
import { prepareOutputSource, captureCollectionIntent } from '../../src/output-source/index.js';
import type { CollectedSource, CollectionIntent } from '../../src/output-source/index.js';
import { admissionFixture, configuration, observation, now, reserved, scope } from '../admission/fixtures.js';
import vectors from '../../../contracts/fixtures/output-source/v1.json' with { type: 'json' };

type Mutable<T> = T extends readonly (infer Item)[] ? Mutable<Item>[] : T extends object ? { -readonly [Key in keyof T]: Mutable<T[Key]> } : T;
export const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
export const json = (value: unknown): string => encodeCanonicalJson(value, 131_072);
export const tables = ['accepted_attempts', 'admission_settings', 'admission_queue', 'reservations', 'event_spool',
  'supervision_clock', 'journal_authority', 'cancelled_originals', 'disk_holds', 'disk_retention_stats', 'output_collection_intents', 'output_sources'];
export function rows(db: DatabaseSync) { return tables.map(table => ({ table, rows: db.prepare(`SELECT * FROM ${table}`).all() })); }
export function used(db: DatabaseSync): number {
  return Number(db.prepare('SELECT spool_bytes+snapshot_bytes+checkpoint_bytes+hold_bytes+collection_bytes+source_bytes+delivery_bytes+absence_bytes+cleanup_control_bytes AS n FROM accepted_attempts').get()?.n);
}
export function inspect(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try { return { rows: rows(db), foreignKeys: db.prepare('PRAGMA foreign_key_check').all() }; } finally { db.close(); }
}
export function sourceFixture() {
  const f = admissionFixture(); const databases = new Set<DatabaseSync>();
  afterEach(() => { for (const db of databases) db.close(); databases.clear(); });
  async function seed(path = f.path(), beforeClaim?: (input: { journal: Journal; offer: Offer; specDigest: string }) => Promise<void>, interrupted = false) {
    const { journal, offer } = await admitted(f, path);
    const key = scope(offer); const draft = structuredClone(vectors.vectors[0]!.input) as Mutable<CollectedSource>;
    if (beforeClaim) await beforeClaim({ journal, offer, specDigest: draft.binding.specDigest });
    const { binding, launch } = await launched(journal, key, draft.binding.specDigest, interrupted);
    draft.binding = { ...draft.binding, ...key, generation: 1, journalAuthority: await journal.journalAuthority(),
      intentDigest: offer.intentDigest, engine: offer.engine, installedIdentity: offer.installedIdentity };
    const sealedAt = draft.collection.value.seal.sealedAt;
    draft.collection.value = sealedResult(draft.collection.value, key, interrupted);
    const checkpoint = await wrapped(journal, key, draft, interrupted, sealedAt);
    draft.checkpoint = checkpoint; draft.collection.custody.controlBytes = checkpoint.offset;
    draft.collection.verifiedBytes = draft.collection.custody.resultFileBytes + checkpoint.offset
      + draft.collection.value.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
    draft.release = { ...draft.release, ...binding, runtime: { ...draft.release.runtime, observedAt: now + 3 },
      collection: { ...draft.release.collection, observedAt: now + 5 }, launch: { epoch: launch.epoch, startToken: launch.startToken, settlementId: launch.evidenceId } };
    const intent: CollectionIntent = captureCollectionIntent({ version: 1, collectionId: draft.collectionId, binding: draft.binding,
      root: draft.collection.custody.root, checkpoint, launch, runtime: draft.release.runtime, begunAt: now + 4 });
    const failed: FailedOutputCollection = { collectionId: draft.collectionId,
      evidence: { ...draft.release, collection: { ...draft.release.collection, state: 'failed' } } };
    return { path, journal, offer, key, intent, collected: draft, source: prepareOutputSource(draft, hash), failed };
  }
  async function native() {
    const value = await seed(); await f.close(value.journal);
    const db = initialize(value.path); databases.add(db); const store = new Store(db); let id = 0;
    return { ...value, db, store, op: (operation: OutputSourceOperation) => store.execute({ ...operation, id: ++id }) };
  }
  function closeNative(db: DatabaseSync): void { db.close(); databases.delete(db); }
  function corruptCopy(path: string): DatabaseSync {
    const db = new DatabaseSync(':memory:'); databases.add(db);
    db.prepare('ATTACH DATABASE ? AS original').run(path);
    for (const table of tables) db.exec(`CREATE TABLE ${table} AS SELECT * FROM original.${table};`);
    const indexes = db.prepare("SELECT sql FROM original.sqlite_master WHERE type='index' AND sql IS NOT NULL").all();
    for (const index of indexes) db.exec(String(index.sql));
    db.exec('DETACH DATABASE original'); return db;
  }
  return { ...f, seed, native, closeNative, corruptCopy };
}
/** Withhold a real committed worker reply while the original caller stays pending. */
export async function loseReply(journal: Journal, issue: () => Promise<unknown>): Promise<unknown> {
  const receive = Reflect.get(journal, 'receive') as (reply: unknown) => void;
  const id = Number(Reflect.get(journal, 'nextId')) + 1;
  let observed!: (value: unknown) => void; const committed = new Promise(resolve => { observed = resolve; });
  Reflect.set(journal, 'receive', (reply: unknown) => {
    if (reply && typeof reply === 'object' && Reflect.get(reply, 'id') === id && Reflect.get(reply, 'ok') === true) {
      observed(Reflect.get(reply, 'value')); return;
    }
    receive.call(journal, reply);
  });
  let settled = false; const pending = issue();
  void pending.then(() => { settled = true; }, () => { settled = true; });
  const value = await Promise.race([committed, pending.then(() => { throw new Error('Reply delivered'); })]);
  if (settled) throw new Error('Original did not remain pending');
  await journal.abort();
  try { await pending; throw new Error('Original succeeded after withheld reply'); }
  catch (error) { if (!(error instanceof Error) || !('code' in error) || error.code !== 'unavailable') throw error; }
  return value;
}

type Admission = ReturnType<typeof admissionFixture>;
type Key = ReturnType<typeof scope>;
type Draft = Mutable<CollectedSource>;

/** Configures capacity, then queues and admits one offer with a 100 kB output budget. */
async function admitted(f: Admission, path: string) {
  const journal = await f.configured(path); const offer = f.job(); offer.budget.outputBytes = 100_000;
  const config = configuration(); config.pool.outputBytes = 200_000; config.perRun.outputBytes = 200_000;
  const observed = observation(); observed.capacity.outputBytes = 200_000;
  await journal.admission({ kind: 'configure', configuration: config }); await journal.admission({ kind: 'observe', observation: { ...observed, observedAt: now + 1 } });
  await f.enqueue(journal, offer, now + 1); reserved(await f.admit(journal, offer, now + 1));
  return { journal, offer };
}

/** Claims, binds and settles the synthetic runtime; an interrupted launch also records its start. */
async function launched(journal: Journal, key: Key, specDigest: string, interrupted: boolean) {
  const claim = await journal.admission({ kind: 'claimCreate', key, specDigest });
  if (!('token' in claim)) throw new Error('Missing actual claim');
  const binding = { key, createToken: claim.token, specDigest, runtimeId: 'synthetic-source-runtime' };
  await journal.admission({ kind: 'bindRuntime', ...binding });
  const started = interrupted ? await journal.admission({ kind: 'claimStart', ...binding, now: now + 1 }) : null;
  if (started && !('token' in started)) throw Error('Missing synthetic start');
  const launch = { authority: 'supervisor' as const, ...binding, epoch: interrupted ? 1 as const : 0 as const,
    startToken: started?.token ?? null, disposition: 'retired' as const,
    settledAt: now + 2, evidenceId: 'synthetic-source-settlement' };
  await journal.admission({ kind: 'settleLaunch', settlement: launch });
  return { binding, launch };
}

/** Re-seals the vector result for this attempt; an interrupted one is an incomplete, inconclusive result. */
function sealedResult(value: Draft['collection']['value'], key: Key, interrupted: boolean): Mutable<EngineResult> {
  const { seal, ...body } = { ...value, ...key };
  const sealed = sealEngineResult(interrupted ? {
    ...body, completeness: 'missing', outcome: 'inconclusive', thresholds: [],
    requiredAssertions: { required: 2, passed: 0, failed: 0, unknown: 2 },
    execution: { status: 'error', reason: 'artifact_incomplete', exitCode: null, stoppedAt: seal.sealedAt },
  } : body, seal.sealedAt, hash); if (!sealed.ok) throw new Error('Synthetic result invalid');
  return structuredClone(sealed.value) as Mutable<EngineResult>;
}

/** Commits the seal event as the wrapper's first batch; an interrupted run adds the supervisor's OOM exit. */
async function wrapped(journal: Journal, key: Key, draft: Draft, interrupted: boolean, sealedAt: string) {
  const event = { ...key, version: '1.0', seq: 1, phase: 'seal', kind: 'engine.result',
    observedAt: '2026-01-01T00:00:00Z', payload: draft.collection.value } as ControlEvent;
  const raw = JSON.stringify(event) + '\n';
  const checkpoint = await journal.commitWrapperBatch({ key, expected: null, events: [event], next: {
    version: 1, dev: draft.collection.custody.root.device, ino: draft.checkpoint.ino,
    offset: Buffer.byteLength(raw), wrapperSeq: 1, prefixSha256: hash(raw) } });
  if (interrupted) await journal.appendSupervisor({ sourceOrdinal: 2, event: {
    version: '1.0', ...key, source: 'agent', phase: 'execute', kind: 'runtime.exited', observedAt: sealedAt,
    payload: { exitCode: 1, oomKilled: true, observedAt: sealedAt, reason: 'memory_limit' },
  } });
  return checkpoint;
}
