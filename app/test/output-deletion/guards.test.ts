import { expect, it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { claimsFixture, makeLegacy } from '../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { absenceFixture } from '../output-absence/fixture.js';
import { finalizationFixture } from '../output-finalization/fixture.js';
import { begin, command, file, plan, ready, scope, uuid } from './fixture.js';
it('rejects active and unsettled attempts, distinguishing a provably unsent cancellation from settled absence', () => {
  const f = claimsFixture();
  try {
    const key = f.add(); const request = () => ({kind: 'beginOutputDeletion' as const, command: command({...f, key})});
    expect(() => f.store.execute(request())).toThrow();
    f.store.execute({kind: 'cancelRun', command: cancelCommand(key.runId)});
    expect(f.store.execute(request())).toMatchObject({kind: 'unsent', fileCount: 0, stage: 'files_absent', retainedPayloadBytes: 0, metadataBytes: 0});
  } finally {f.db.close();}
  const g = finalizationFixture(); g.ready();
  expect(() => g.store.execute({kind: 'beginOutputDeletion', command: command(g)})).toThrow();
  const h = absenceFixture(); h.ready(); expect(h.finalize()).toMatchObject({kind: 'finalized'});
  expect(h.store.execute({kind: 'beginOutputDeletion', command: command(h)})).toMatchObject({kind: 'absence', fileCount: 0, metadataBytes: 65536});
});
it('rejects premature/stale/foreign progress and fixes one namespace without changing prior progress', () => {
  const f = ready(2); const {key} = begin(f); const first = file(f, key); const native = plan(first);
  const prepare = {kind: 'recordOutputDeletionPlan' as const, request: {key: {...key, ordinal: 0}, expectedVersion: 1, plan: native}};
  const absent = {kind: 'recordOutputDeletionAbsence' as const, request: {key: {...key, ordinal: 0}, expectedVersion: 2, receipt: {...native, phase: 'absent' as const}}};
  const snapshot = () => encodeCanonicalJson(['output_deletion_intents', 'output_deletion_files', 'installation_storage_usage'].map(table => f.db.prepare(`SELECT * FROM ${table}`).all()), 65536);
  const before = snapshot(); expect(() => f.store.execute(absent)).toThrow();
  expect(() => f.store.execute({...prepare, request: {...prepare.request, expectedVersion: 2}})).toThrow();
  expect(() => f.store.execute({...prepare, request: {...prepare.request, plan: {...native, record: {...native.record, artifact: {...native.record.artifact, sha256: 'f'.repeat(64)}}}}})).toThrow();
  expect(snapshot()).toBe(before); f.store.execute(prepare); const prepared = snapshot();
  expect(() => f.store.execute({...prepare, request: {...prepare.request, plan: {...native, preparationIdentity: 'c'.repeat(64)}}})).toThrow();
  expect(() => f.store.execute({kind: 'recordOutputDeletionPlan', request: {key: {...key, ordinal: 1}, expectedVersion: 1, plan: plan(file(f, key, 1), 'c'.repeat(64))}})).toThrow();
  expect(() => f.store.execute({...absent, request: {...absent.request, expectedVersion: 1}})).toThrow();
  expect(snapshot()).toBe(prepared); f.store.execute(absent);
  expect(f.store.execute(prepare)).toMatchObject({phase: 'absent', version: 3});
  expect(() => f.store.execute({kind: 'getOutputDeletionFile', key: {...key, runId: uuid(999), ordinal: 0}})).toThrow('not_found');
});
it('enforces immutable capture and monotonic progress in SQLite without relaxing existing guards', () => {
  const f = ready(); const {key} = begin(f);
  for (const sql of [
    'DELETE FROM output_deletion_intents', 'DELETE FROM output_deletion_files',
    'UPDATE output_deletion_intents SET pending_files=0,version=version+1',
    "UPDATE output_deletion_intents SET closure_digest='ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff'",
    'UPDATE output_deletion_files SET absent=1,version=3',
    'UPDATE output_deletion_files SET version=2',
    'INSERT OR REPLACE INTO output_deletion_files SELECT * FROM output_deletion_files',
    'INSERT OR REPLACE INTO output_deletion_intents SELECT * FROM output_deletion_intents',
  ]) expect(() => f.db.exec(sql), sql).toThrow();
  expect(f.store.execute({kind: 'getOutputDeletion', key})).toMatchObject({version: 1, absentCount: 0});
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  const query = f.db.prepare('EXPLAIN QUERY PLAN SELECT sequence FROM output_deletion_intents WHERE pending_files>0 AND sequence>? ORDER BY sequence LIMIT ?').all(0, 33);
  expect(JSON.stringify(query)).toContain('output_deletion_pending');
});
it('validates logical command intent before returning an existing request receipt', () => {
  const f = ready(); const {operation} = begin(f);
  for (const patch of [{expectedRunVersion: 99}, {runId: uuid(999)}, {scope: {...scope, workspaceId: uuid(999)}}]) {
    expect(() => f.store.execute({...operation, command: {...operation.command, request: {...operation.command.request, ...patch}}})).toThrow();
  }
});

it.each(['legacy', 'acknowledged', 'second_attempt'] as const)('refuses terminal ownership without positive unsent witnesses: %s', mode => {
  const f = claimsFixture();
  try {
    const key = f.add();
    if (mode === 'legacy') makeLegacy(f.db, key);
    if (mode === 'acknowledged') f.db.exec('DROP TRIGGER attempts_owned_ack; UPDATE attempts SET generation=1');
    if (mode === 'second_attempt') f.db.prepare(`INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,
      offer_json,registry_json,generation,state,foundation_owned) SELECT ?,run_id,organization_id,workspace_id,2,intent_digest,
      json_set(offer_json,'$.attemptId',?),registry_json,NULL,'offered',1 FROM attempts`).run(uuid(180), uuid(180));
    f.db.exec("DELETE FROM dispatch_outbox; UPDATE runs SET state='cancelled',outcome='inconclusive',reason='cancelled',cancellation_requested=1");
    expect(() => f.store.execute({kind: 'beginOutputDeletion', command: command({...f, key})})).toThrow();
    expect(() => f.db.prepare(`INSERT INTO output_deletion_intents(id,run_id,attempt_id,organization_id,workspace_id,request_id,
      run_version,deletion_version,version,kind,requested_at,closure_digest,retained_payload_bytes,metadata_bytes,file_count,pending_files)
      SELECT ?,id,active_attempt_id,organization_id,workspace_id,?,version,1,1,'unsent','2026-11-12T00:00:00.000Z',NULL,0,0,0,0 FROM runs`)
      .run(uuid(400), uuid(500))).toThrow();
    expect(f.db.prepare('SELECT * FROM output_deletion_intents').all()).toEqual([]);
  } finally {f.db.close();}
});
