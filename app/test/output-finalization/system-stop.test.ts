import {expect,it} from 'vitest';
import {finalizationFixture} from './fixture.js';
import {absenceFixture} from '../output-absence/fixture.js';
const reasons=['timeout','output_limit','artifact_incomplete','clock_integrity'] as const;
it.each(reasons)('preserves verified system stop %s through sealed finalization',reason=>{
 const f=finalizationFixture();f.adopt();f.release({cancelRequested:true,
  exitEvidence:{exitCode:137,oomKilled:false,reason,observedAt:'2026-01-01T00:01:00Z'}});f.ingest();f.confirm();
 expect(f.reads.get({id:f.key.runId,scope:{kind:'workspace',organizationId:f.key.attempt.organizationId,workspaceId:f.key.attempt.workspaceId}}).cancellationRequested).toBe(false);
 expect(f.finalize()).toMatchObject({kind:'finalized',receipt:{state:'errored',outcome:'inconclusive',reason}});
});
it.each(reasons)('a later user request cannot relabel verified system stop %s',reason=>{
 const f=finalizationFixture();f.adopt();f.release({cancelRequested:true,
  exitEvidence:{exitCode:137,oomKilled:false,reason,observedAt:'2026-01-01T00:01:00Z'}});f.ingest();f.confirm();
 f.db.exec('UPDATE runs SET cancellation_requested=1,version=version+1');
 expect(f.finalize()).toMatchObject({kind:'finalized',receipt:{state:'errored',outcome:'inconclusive',reason}});
});
it.each(reasons)('preserves validated source-free stop %s, including a later user request',reason=>{
 const f=absenceFixture({reason});f.adopt();f.release({cancelRequested:true});f.ingest();f.confirm();
 f.db.exec('UPDATE runs SET cancellation_requested=1,version=version+1');
 expect(f.finalize()).toMatchObject({kind:'finalized',receipt:{state:'errored',outcome:'inconclusive',reason}});
});
it.each(reasons)('requires known physical exit facts for system stop %s despite user intent',reason=>{
 const f=finalizationFixture();f.adopt();f.release({cancelRequested:true,
  exitEvidence:{exitCode:null,oomKilled:false,reason,observedAt:'2026-01-01T00:01:00Z'}});f.ingest();f.confirm();
 f.db.exec('UPDATE runs SET cancellation_requested=1,version=version+1');
 expect(f.finalize()).toEqual({kind:'pending',reason:'exit_evidence'});
});
it('preserves OOM precedence over system stop and user intent',()=>{
 const f=finalizationFixture();f.adopt();f.release({cancelRequested:true,
  exitEvidence:{exitCode:137,oomKilled:true,reason:'output_limit',observedAt:'2026-01-01T00:01:00Z'}});f.ingest();f.confirm();
 f.db.exec('UPDATE runs SET cancellation_requested=1,version=version+1');
 expect(f.finalize()).toMatchObject({kind:'finalized',receipt:{state:'errored',reason:'memory_limit'}});
});

it('settles an already captured clean exit when the same sequence gains its durable system cause', () => {
  const f = finalizationFixture();
  f.adopt();
  f.release({ systemStopReason: undefined });
  f.ingest();
  f.confirm();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'stop_evidence' });

  f.release({ cancelRequested: true, systemStopReason: 'artifact_incomplete' });
  f.release({ cancelRequested: true, systemStopReason: undefined });
  const first = f.finalize();
  expect(first).toMatchObject({
    kind: 'finalized',
    receipt: { state: 'errored', outcome: 'inconclusive', reason: 'artifact_incomplete' },
  });
  const charged = f.usage();
  expect(f.finalize()).toEqual(first);
  expect(f.usage()).toBe(charged);
});

it('rejects a changed durable system cause at the same sequence', () => {
  const f = finalizationFixture();
  f.adopt();
  f.release({ cancelRequested: true, systemStopReason: 'artifact_incomplete' });
  expect(() => f.release({ cancelRequested: true, systemStopReason: 'timeout' })).toThrow();
  expect(() => f.db.prepare(
    "UPDATE execution_records SET snapshot_json=json_set(snapshot_json,'$.systemStopReason','timeout')",
  ).run()).toThrow(/immutable system stop evidence/);
});

it('keeps typed system stop pending when physical exit facts remain unknown', () => {
  const f = finalizationFixture();
  f.adopt();
  f.release({
    cancelRequested: true,
    systemStopReason: 'clock_integrity',
    exitEvidence: { exitCode: null, oomKilled: null, observedAt: '2026-01-01T00:01:00Z' },
  });
  f.ingest();
  f.confirm();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'exit_evidence' });
});

it('keeps a closure marker at a stale sequence from authorizing a receipt', () => {
  const f = finalizationFixture({ events: 3 });
  f.adopt();
  f.release({ lastSeq: 2, systemStopReason: null });
  expect(() => f.db.exec("UPDATE execution_records SET snapshot_json=json_set(snapshot_json,'$.lastSeq',3)"))
    .toThrow(/immutable system stop evidence/);
  f.ingest();
  f.confirm();
  expect(f.finalize()).toEqual({ kind: 'pending', reason: 'stop_evidence' });
});

it('rejects stop evidence before settled release and preserves explicit null at equal sequence', () => {
  const f = finalizationFixture();
  f.adopt();
  expect(() => f.release({ admission: { state: 'charged' }, systemStopReason: null })).toThrow();
  f.release({ systemStopReason: null });
  f.release({ systemStopReason: undefined });
  expect(() => f.release({ cancelRequested: true, systemStopReason: 'timeout' })).toThrow();
  f.ingest();
  f.confirm();
  expect(f.finalize()).toMatchObject({ kind: 'finalized', receipt: { state: 'finished' } });
});
