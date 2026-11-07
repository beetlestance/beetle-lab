import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { build } from 'tsup';
import { validate } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { JournalError, openJournal } from '../../src/journal/index.js';
import type { AttemptKey, Journal } from '../../src/journal/index.js';

let root: string;
let workerUrl: URL;
let original: Offer;
let counter = 0;
const handles = new Set<Journal>();
function key(offer: Offer): AttemptKey {
  return { attemptId: offer.attemptId, organizationId: offer.organizationId, workspaceId: offer.workspaceId };
}
function offer(): Offer { return structuredClone(original); }
function dbPath(): string { return join(root, `journal-${++counter}.sqlite`); }
async function open(path = dbPath(), queueLimit = 32): Promise<Journal> {
  const journal = await openJournal({ path, workerUrl, queueLimit }); handles.add(journal); return journal;
}
async function close(journal: Journal): Promise<void> { await journal.close(); handles.delete(journal); }

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'beetle-journal-'));
  const outDir = join(root, 'worker');
  await build({ entry: ['agent/src/journal/worker.ts'], outDir, format: ['esm'],
    platform: 'node', target: 'node24', bundle: true, noExternal: [/.*/], shims: true,
    removeNodeProtocol: false, splitting: false, silent: true });
  workerUrl = pathToFileURL(join(outDir, 'worker.js'));
  original = JSON.parse(await readFile('contracts/fixtures/valid/offer.json', 'utf8')) as Offer;
}, 20000);
afterEach(async () => { await Promise.all([...handles].map(journal => journal.abort())); handles.clear(); });
afterAll(async () => { await rm(root, { recursive: true, force: true }); });

describe('durable immutable offer identity', () => {
  it('returns a protocol snapshot, stores original JSON, and ignores object-key order on duplicate', async () => {
    const path = dbPath(); const journal = await open(path);
    const value = offer(); const initial = await journal.immutableOffer(value);
    expect(validate('AttemptSnapshot', initial).ok).toBe(true);
    expect(initial).toMatchObject({ generation: 1, state: 'offered', lastSeq: 0, cancelRequested: false });
    const reordered = Object.fromEntries(Object.entries(value).reverse());
    expect(await journal.immutableOffer(reordered)).toEqual(initial);
    expect(await journal.readOffer(key(value))).toEqual(value);
    value.config = { mutatedAfterSubmit: true };
    expect(await journal.readOffer(key(value))).toEqual(original);
    await close(journal);
    const inspection = new DatabaseSync(path);
    try { expect(inspection.prepare('SELECT count(*) AS n FROM accepted_attempts').get()?.n).toBe(1); }
    finally { inspection.close(); }
  });

  it('rejects changed digest, config, org/workspace and reference metadata under the same ID', async () => {
    const journal = await open(); await journal.immutableOffer(offer());
    const changes: Partial<Offer>[] = [
      { intentDigest: 'b'.repeat(64) }, { config: { synthetic: false } },
      { organizationId: '00000000-0000-4000-8000-000000000099' },
      { workspaceId: '00000000-0000-4000-8000-000000000098' },
      { secretReferences: [{ name: 'api-token', provider: 'mounted', reference: 'other-ref', version: 'v1' }] },
    ];
    for (const change of changes) await expect(journal.immutableOffer({ ...offer(), ...change })).rejects.toMatchObject({ code: 'conflict' });
    expect(await journal.readOffer(key(original))).toEqual(original);
  });

  it('persists identity/cancel intent across restart without changing offered state or sequence', async () => {
    const path = dbPath(); const first = await open(path);
    await first.immutableOffer(offer());
    const cancelled = await first.durableCancel(key(original));
    expect(await first.durableCancel(key(original))).toEqual(cancelled);
    await close(first);
    const restarted = await open(path);
    expect(await restarted.get(key(original))).toEqual(cancelled);
    expect(await restarted.immutableOffer(offer())).toEqual(cancelled);
    expect(cancelled).toMatchObject({ generation: 1, lastSeq: 0, state: 'offered', cancelRequested: true });
    expect(cancelled).not.toHaveProperty('exitEvidence');
    expect(cancelled).not.toHaveProperty('result');
  });

  it('bounds cursor pages to snapshots and persists continuation across restart', async () => {
    const path = dbPath(); let journal = await open(path);
    for (let i = 1; i <= 103; i++) {
      const value = offer(); value.attemptId = `00000000-0000-4000-8001-${String(i).padStart(12, '0')}`;
      await journal.immutableOffer(value);
    }
    const first = await journal.listOpen({ limit: 100 });
    expect(first.snapshots).toHaveLength(100); expect(first.cursor).toBeDefined();
    expect(first.snapshots.every(value => validate('AttemptSnapshot', value).ok)).toBe(true);
    expect(first.snapshots.some(value => 'config' in value)).toBe(false);
    await close(journal); journal = await open(path);
    const last = await journal.listOpen({ limit: 100, cursor: first.cursor! });
    expect(last.snapshots).toHaveLength(3); expect(last.cursor).toBeUndefined();
    expect(new Set([...first.snapshots, ...last.snapshots].map(value => value.attemptId)).size).toBe(103);
    await expect(journal.listOpen({ limit: 101 })).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(journal.listOpen({ limit: 1, cursor: -1 })).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('isolates scoped reads/cancels and rejects missing attempt identities', async () => {
    const journal = await open(); await journal.immutableOffer(offer());
    const wrong = { ...key(original), organizationId: '00000000-0000-4000-8000-000000000099' };
    for (const operation of [journal.get(wrong), journal.readOffer(wrong), journal.durableCancel(wrong)]) {
      await expect(operation).rejects.toMatchObject({ code: 'not_found' });
    }
    expect((await journal.get(key(original))).cancelRequested).toBe(false);
    await expect(journal.get({ ...key(original), attemptId: 'bad' })).rejects.toMatchObject({ code: 'invalid_input' });
  });
});

describe('real SQLite ownership and worker lifecycle', () => {
  it('refuses a second independent worker between transactions then reacquires after clean close', async () => {
    const path = dbPath(); const first = await open(path);
    await first.immutableOffer(offer());
    await expect(open(path)).rejects.toMatchObject({ code: 'owned' });
    await close(first);
    const successor = await open(path);
    expect((await successor.get(key(original))).generation).toBe(1);
  });

  it('releases the real SQLite lock on abrupt worker termination and preserves committed data', async () => {
    const path = dbPath(); const first = await open(path);
    await first.immutableOffer(offer()); await first.durableCancel(key(original));
    await first.abort(); handles.delete(first);
    const successor = await open(path);
    expect((await successor.get(key(original))).cancelRequested).toBe(true);
  });

  it('preserves a future-version DB and closes its failed startup connection', async () => {
    const path = dbPath(); const db = new DatabaseSync(path);
    db.exec("CREATE TABLE canary(value TEXT); INSERT INTO canary VALUES ('safe'); PRAGMA user_version=99;"); db.close();
    const before = await readFile(path);
    await expect(open(path)).rejects.toMatchObject({ code: 'schema_newer' });
    expect(await readFile(path)).toEqual(before);
    const inspect = new DatabaseSync(path);
    try {
      expect(inspect.prepare('PRAGMA user_version').get()?.user_version).toBe(99);
      expect(inspect.prepare('SELECT value FROM canary').get()?.value).toBe('safe');
    } finally { inspect.close(); }
  });

  it('bounds in-flight commands and drains accepted commands before close', async () => {
    const path = dbPath(); const journal = await open(path, 1);
    const accepted = journal.immutableOffer(offer());
    await expect(journal.get(key(original))).rejects.toMatchObject({ code: 'queue_full' });
    const closing = journal.close();
    await expect(journal.listOpen({ limit: 1 })).rejects.toMatchObject({ code: 'closed' });
    await expect(accepted).resolves.toMatchObject({ state: 'offered' });
    await closing; handles.delete(journal);
    expect(journal.close()).toBe(closing);
    const next = await open(path); expect((await next.get(key(original))).generation).toBe(1);
  });

  it('explicitly fails queued work on abort, with no acceptance claim under unknown commit outcome', async () => {
    const journal = await open();
    const pending = journal.immutableOffer(offer());
    const result = expect(pending).rejects.toMatchObject({ code: 'unavailable' });
    await journal.abort(); handles.delete(journal); await result;
  });

  it('rejects pending callers on an actual journal worker crash and releases OS ownership', async () => {
    const path = dbPath(); const entry = join(root, 'crashing-worker.mjs');
    await writeFile(entry, `import {parentPort} from 'node:worker_threads';
      parentPort.on('message',command=>{ if(command.kind==='get') process.exit(17); });
      await import(${JSON.stringify(workerUrl.href)});`);
    const journal = await openJournal({ path, workerUrl: pathToFileURL(entry) }); handles.add(journal);
    await journal.immutableOffer(offer());
    const results = await Promise.allSettled([journal.get(key(original)), journal.get(key(original))]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      if (result.status !== 'rejected') throw new Error('expected failure');
      expect(result.reason).toBeInstanceOf(JournalError);
      expect(result.reason).toMatchObject({ code: 'unavailable', message: 'Journal unavailable' });
    }
    await journal.abort(); handles.delete(journal);
    const successor = await open(path);
    expect((await successor.get(key(original))).generation).toBe(1);
  });

  it('fails a stalled worker command at the availability deadline and terminates its handle', async () => {
    const entry = join(root, 'stalled-worker.mjs');
    await writeFile(entry, "import {parentPort} from 'node:worker_threads'; parentPort.on('message',()=>{}); parentPort.postMessage({kind:'ready'});");
    const journal = await openJournal({ path: dbPath(), workerUrl: pathToFileURL(entry) }); handles.add(journal);
    await expect(journal.immutableOffer(offer())).rejects.toMatchObject({ code: 'unavailable' });
    await journal.abort(); handles.delete(journal);
  });
});

describe('bounded and safe public input errors', () => {
  it('rejects malformed/oversized payloads and accessors without exposing data or invoking getters', async () => {
    const journal = await open(); let invoked = false;
    const accessor = Object.defineProperty(offer(), 'config', { enumerable: true, get() { invoked = true; throw new Error('CANARY'); } });
    for (const input of [accessor, { ...offer(), config: { value: 'CANARY'.repeat(200000) } }, { ...offer(), protocolVersion: '999' }, null]) {
      await expect(journal.immutableOffer(input)).rejects.toMatchObject({ code: 'invalid_input', message: 'Journal invalid_input' });
    }
    expect(invoked).toBe(false); expect((await journal.listOpen({ limit: 1 })).snapshots).toEqual([]);
  });

  it('redacts startup path/SQL failures and validates queue configuration', async () => {
    await expect(open(join(root, 'CANARY-missing-directory', 'journal.sqlite'))).rejects.toMatchObject({ message: 'Journal unavailable' });
    const entry = join(root, 'startup-failure.mjs');
    await writeFile(entry, "throw new Error('SQL CANARY /private/sensitive');");
    await expect(openJournal({ path: dbPath(), workerUrl: pathToFileURL(entry) })).rejects.toMatchObject({ message: 'Journal unavailable' });
    for (const queueLimit of [0, 65, 1.5]) await expect(open(dbPath(), queueLimit)).rejects.toMatchObject({ code: 'invalid_input' });
    await expect(open(':memory:')).rejects.toMatchObject({ code: 'invalid_input' });
  });
});
