import { expect, it } from 'vitest';
import { receiptForOutputSource } from '../../src/output-source/index.js';
import { hash, json, rows, sourceFixture } from './fixtures.js';

const f = sourceFixture();
it('commits real worker intent/source and releases only exact stored proof, preserving immutable metadata and disk promises', async () => {
  const e = await f.seed(); const { journal } = e;
  expect(await journal.readOutputCollection(e.key)).toBeNull(); expect(await journal.readOutputSource(e.key)).toBeNull();
  await expect(journal.admission({ kind: 'release', evidence: e.collected.release })).rejects.toMatchObject({ code: 'conflict' });
  expect(await journal.beginOutputCollection(e.intent)).toEqual(e.intent);
  await expect(journal.admission({ kind: 'release', evidence: e.failed.evidence })).rejects.toMatchObject({ code: 'conflict' });
  const receipt = await journal.commitOutputSource(e.collected);
  expect(receipt).toEqual(receiptForOutputSource(e.source, hash));
  expect(await journal.commitOutputSource(e.collected)).toEqual(receipt);
  expect(await journal.readOutputSource(e.key)).toEqual(e.source);
  const wrong = { ...receipt, sourceDigest: '0'.repeat(64) };
  await expect(journal.releaseOutputSource(wrong)).rejects.toMatchObject({ code: 'conflict' });
  const released = await journal.releaseOutputSource(receipt);
  expect(released.status).toBe('released'); expect(released.releaseEvidence).toEqual(e.collected.release);
  expect(await journal.releaseOutputSource(receipt)).toEqual(released);
  expect(await journal.admission({ kind: 'release', evidence: e.collected.release })).toEqual(released);
  await f.close(journal);
  const reopened = await f.open(e.path);
  expect(await reopened.journalAuthority()).toBe(e.intent.binding.journalAuthority);
  expect(await reopened.readOutputCollection(e.key)).toEqual(e.intent);
  expect(await reopened.readOutputSource(e.key)).toEqual(e.source);
  expect(await reopened.commitOutputSource(e.collected)).toEqual(receipt);
  expect(await reopened.releaseOutputSource(receipt)).toEqual(released);
  expect(Object.isFrozen(await reopened.readOutputSource(e.key))).toBe(true);
});
it.each(['authority', 'engine', 'installed', 'intent', 'spec', 'checkpoint', 'launch'] as const)('rejects begin %s disagreement without writing source authority', async kind => {
  const e = await f.seed(); const value = structuredClone(e.intent);
  const mutations = {
    authority: () => { Reflect.set(value.binding, 'journalAuthority', '22222222-2222-4222-8222-222222222222'); },
    engine: () => { Reflect.set(value.binding.engine, 'imageDigest', `sha256:${'f'.repeat(64)}`); },
    installed: () => { Reflect.set(value.binding.installedIdentity, 'profileDigest', '0'.repeat(64)); },
    intent: () => { Reflect.set(value.binding, 'intentDigest', '0'.repeat(64)); },
    spec: () => { Reflect.set(value.binding, 'specDigest', '0'.repeat(64)); Reflect.set(value.launch, 'specDigest', '0'.repeat(64)); },
    checkpoint: () => { Reflect.set(value.checkpoint, 'prefixSha256', '0'.repeat(64)); },
    launch: () => { Reflect.set(value.launch, 'createToken', 'wrong'); },
  };
  mutations[kind](); await expect(e.journal.beginOutputCollection(value)).rejects.toMatchObject({ code: 'conflict' });
  expect(await e.journal.readOutputCollection(e.key)).toBeNull();
});
it('preserves not_found and stale_generation for tracked reads and scoped writes', async () => {
  const e = await f.seed();
  for (const read of [e.journal.readOutputSource.bind(e.journal), e.journal.readOutputCollection.bind(e.journal)]) {
    await expect(read({ ...e.key, generation: 2 })).rejects.toMatchObject({ code: 'stale_generation' });
    await expect(read({ ...e.key, workspaceId: e.key.attemptId })).rejects.toMatchObject({ code: 'not_found' });
  }
  await expect(e.journal.releaseOutputSource(receiptForOutputSource(e.source, hash))).rejects.toMatchObject({ code: 'conflict' });
  await expect(e.journal.commitOutputSource(e.collected)).rejects.toMatchObject({ code: 'conflict' });
});
it.each(['root', 'runtime', 'result', 'budget', 'chronology'] as const)('rejects source %s disagreement with its real stored intent/original', async kind => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); const value = structuredClone(e.collected);
  if (kind === 'root') value.collection.custody.root.directory = '/synthetic/replaced';
  if (kind === 'runtime') value.release.runtime.evidenceId = 'wrong-runtime';
  if (kind === 'result') {const result=value.collection.value;if ('purpose' in result) throw new Error('Expected performance fixture');result.artifacts.reverse();}
  if (kind === 'budget') { value.collection.custody.resultFileBytes = 1_048_576; value.collection.verifiedBytes += 1_048_576 - e.collected.collection.custody.resultFileBytes; }
  if (kind === 'chronology') value.release.collection.observedAt = e.intent.begunAt - 1;
  if (kind === 'result') {
    const { sealEngineResult } = await import('@beetle/contracts'); const { seal, ...body } = value.collection.value;
    const sealed = sealEngineResult(body, seal.sealedAt, hash); if (!sealed.ok) throw new Error('fixture'); value.collection.value = structuredClone(sealed.value);
  }
  await expect(e.journal.commitOutputSource(value)).rejects.toMatchObject({ code: 'conflict' });
  expect(await e.journal.readOutputSource(e.key)).toBeNull();
});
it('keeps first failure fenced by live epoch while exact terminal failure replay survives reopen', async () => {
  const e = await f.seed(); await e.journal.beginOutputCollection(e.intent); await f.close(e.journal);
  let journal = await f.open(e.path);
  expect(await journal.beginOutputCollection(e.intent)).toEqual(e.intent);
  await expect(journal.failOutputCollection(e.failed)).rejects.toMatchObject({ code: 'conflict' });
  await f.close(journal);
  const other = await f.seed(); await other.journal.beginOutputCollection(other.intent);
  const failed = await other.journal.failOutputCollection(other.failed); await f.close(other.journal);
  journal = await f.open(other.path);
  expect(await journal.failOutputCollection(other.failed)).toEqual(failed);
  const changed = structuredClone(other.failed); Reflect.set(changed.evidence.collection, 'observedAt', other.failed.evidence.collection.observedAt + 1);
  await expect(journal.failOutputCollection(changed)).rejects.toMatchObject({ code: 'conflict' });
  expect(await journal.readOutputSource(other.key)).toBeNull();
});
it('rolls back a genuinely deferred COMMIT fault after source/charge/phase writes', async () => {
  const e = await f.native(); e.op({ kind: 'outputCollectionBegin', json: json(e.intent) });
  e.db.exec(`CREATE TABLE fault_parent(id PRIMARY KEY); CREATE TABLE fault_child(id REFERENCES fault_parent(id) DEFERRABLE INITIALLY DEFERRED);
    CREATE TRIGGER late_source AFTER INSERT ON output_sources BEGIN INSERT INTO fault_child VALUES(1); END;`);
  const before = rows(e.db);
  expect(() => e.op({ kind: 'outputSourceCommit', json: json(e.source) })).toThrow();
  expect(rows(e.db)).toEqual(before); expect(e.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
it.each(['output_collection_intents', 'output_sources'])('rolls back late %s trigger failure with exact native accounting', async table => {
  const e = await f.native();
  if (table === 'output_sources') e.op({ kind: 'outputCollectionBegin', json: json(e.intent) });
  e.db.exec(`CREATE TRIGGER late_fault AFTER INSERT ON ${table} BEGIN SELECT RAISE(ABORT,'synthetic late fault'); END;`);
  const before = rows(e.db);
  const command = table === 'output_sources' ? { kind: 'outputSourceCommit' as const, json: json(e.source) }
    : { kind: 'outputCollectionBegin' as const, json: json(e.intent) };
  expect(() => e.op(command)).toThrow('synthetic late fault'); expect(rows(e.db)).toEqual(before);
});
