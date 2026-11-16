import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { cleanupControl } from '../../src/cleanup-control/index.js';
import { runtimeName } from '../../src/runtime-identity.js';
import { admissionFixture, configuration, observation, reserved, scope } from '../admission/fixtures.js';
import { bindSyntheticNamespace, directories, rootFacts } from './model-fixtures.js';
const f = admissionFixture();
it('refuses admission without a bound namespace and rolls back an unaffordable control reserve', async () => {
  const barePath = f.path(); const bare = await f.open(barePath); const job = f.job();
  await bare.admission({ kind: 'configure', configuration: configuration() }); await bare.admission({ kind: 'observe', observation: observation() });
  await f.enqueue(bare, job); await expect(f.admit(bare, job)).rejects.toMatchObject({ code: 'recovery_required' });
  await f.close(bare); let db = new DatabaseSync(barePath);
  expect(db.prepare('SELECT COUNT(*) AS n FROM reservations').get()?.n).toBe(0);
  expect(db.prepare('SELECT cleanup_control_bytes,staging_namespace_identity FROM accepted_attempts').get()).toEqual({ cleanup_control_bytes: 0, staging_namespace_identity: null }); db.close();
  const path = f.path(); const journal = await f.configured(path, cleanupControl.reservedBytes);
  await f.enqueue(journal, job); await expect(f.admit(journal, job)).rejects.toMatchObject({ code: 'quota_exceeded' });
  await f.close(journal); db = new DatabaseSync(path);
  expect(db.prepare('SELECT COUNT(*) AS n FROM reservations').get()?.n).toBe(0);
  expect(db.prepare('SELECT cleanup_control_bytes,hold_bytes FROM accepted_attempts').get()).toEqual({ cleanup_control_bytes: 0, hold_bytes: 0 }); db.close();
});
it('keeps control available after ordinary spool fills, prevents raw borrowing/refund and survives reopen', async () => {
  const path = f.path(); let journal = await f.configured(path, cleanupControl.reservedBytes + 8192); const job = f.job();
  await f.enqueue(journal, job); const reservation = reserved(await f.admit(journal, job));
  let overflow = false; let last = 1;
  for (let seq = 1; seq <= 20; seq++) {
    try { last = (await journal.appendWrapper({ ...f.wrapper(seq), ...scope(job) })).seq; }
    catch (error) { expect(error).toMatchObject({ code: 'quota_exceeded' }); overflow = true; break; }
  }
  expect(overflow).toBe(true); const before = await journal.get(scope(job)); expect(before.lastSeq).toBe(last);
  const installed = await journal.stagingNamespace.read(); if (installed?.state !== 'bound') throw new Error('Missing metadata binding');
  const intent = { protocolVersion: 1 as const, original: { ...scope(job), generation: 1 as const, intentDigest: job.intentDigest },
    purpose: 'performance' as const, namespaceIdentity: installed.anchor.namespaceIdentity,
    specDigest: 'e'.repeat(64), runtimeName: runtimeName({ ...scope(job), installationId: rootFacts.installationId }) };
  await journal.stagingNamespace.beginTask(intent); const anchor = await journal.stagingNamespace.commitTask({ intent, directories: directories() });
  expect(await journal.get(scope(job))).toEqual(before);
  expect(await journal.admission({ kind: 'reservation', key: scope(job) })).toEqual(reservation);
  await f.close(journal); const db = new DatabaseSync(path);
  const row = db.prepare('SELECT * FROM accepted_attempts').get()!; expect(row.cleanup_control_bytes).toBe(cleanupControl.reservedBytes); expect(row.cleanup_control_version).toBe(1);
  expect(() => db.exec('UPDATE accepted_attempts SET spool_bytes=quota_bytes')).toThrow();
  expect(() => db.exec('UPDATE accepted_attempts SET cleanup_control_bytes=0,staging_namespace_identity=NULL')).toThrow();
  const bytes = db.prepare('SELECT length(CAST(intent_json AS BLOB))+length(CAST(anchor_json AS BLOB))+512 AS n FROM task_staging_namespaces').get()?.n;
  expect(Number(bytes)).toBeLessThanOrEqual(cleanupControl.taskNamespaceBytes); db.close();
  journal = await f.open(path); expect((await journal.stagingNamespace.readTask({ ...scope(job), generation: 1 }))?.state).toBe('prepared');
  expect(await journal.stagingNamespace.commitTask({ intent, directories: directories() })).toEqual(anchor);
});
it('refuses pending fresh binding after history appears rather than manufacturing old custody', async () => {
  const journal = await f.open(); const intent = await journal.stagingNamespace.begin(rootFacts); await journal.immutableOffer(f.offer());
  await expect(bindSyntheticNamespace(journal)).rejects.toMatchObject({ code: 'recovery_required' });
  expect(await journal.stagingNamespace.read()).toEqual({ state: 'preparing', intent });
});
