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
