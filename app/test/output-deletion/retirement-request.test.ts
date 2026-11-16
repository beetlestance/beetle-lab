import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { expect,it } from 'vitest';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { OutputRetirementRequest } from '@beetle/contracts';
import { begin,file,plan,ready,scope,uuid,command } from './fixture.js';
import { absenceFixture } from '../output-absence/fixture.js';
import { captureDeletionReply,captureDeletionOperation } from '../../src/adapters/outbound/sqlite/output-deletion/index.js';
function absentFiles(f:ReturnType<typeof ready>,key:ReturnType<typeof begin>['key'],count:number){
 for(let ordinal=0;ordinal<count;ordinal++){
  const native=plan(file(f,key,ordinal));const owned={key:{...key,ordinal}};
  f.store.execute({kind:'recordOutputDeletionPlan',request:{...owned,expectedVersion:1,plan:native}});
  f.store.execute({kind:'recordOutputDeletionAbsence',request:{...owned,expectedVersion:2,receipt:{...native,phase:'absent'}}});
 }
}
it('projects the exact retained original only after every committed file receipt without changing charges',()=>{
 const f=ready(2);const {key}=begin(f);const read=()=>f.store.execute({kind:'getOutputRetirementRequest',key}) as OutputRetirementRequest;
 expect(read).toThrow();absentFiles(f,key,1);expect(read).toThrow();
 const native=plan(file(f,key,1));const owned={key:{...key,ordinal:1}};
 f.store.execute({kind:'recordOutputDeletionPlan',request:{...owned,expectedVersion:1,plan:native}});
 expect(read).toThrow();f.store.execute({kind:'recordOutputDeletionAbsence',request:{...owned,expectedVersion:2,receipt:{...native,phase:'absent'}}});
 const before=f.usage();const request=read();expect(request).toEqual(captureOutputRetirementRequest({version:1,purpose:'performance',...f.key.attempt,
  runId:f.key.runId,journalAuthority:f.binding.journalAuthority,deletionId:key.id,deletionVersion:1,closure:{kind:'source',sourceDigest:f.envelope.sourceDigest,manifestDigest:f.envelope.manifest.manifestDigest,finalAgentSeq:2}}));
 expect(read()).toEqual(request);expect(f.usage()).toBe(before);
 expect(()=>f.store.execute({kind:'getOutputRetirementRequest',key:{...key,scope:{...scope,workspaceId:uuid(999)}}})).toThrow('not_found');
});
it.each([0,2])('projects a retained absence at final sequence %s and preserves all charges',end=>{
 const f=absenceFixture({end});f.ready();expect(f.finalize()).toMatchObject({kind:'finalized'});
 const original=command(f);f.store.execute({kind:'beginOutputDeletion',command:original});const before=f.usage();
 const key={scope,id:original.id,runId:f.key.runId};const request=f.store.execute({kind:'getOutputRetirementRequest',key}) as OutputRetirementRequest;
 expect(request.closure).toEqual({kind:'absence',proofDigest:f.command().proofDigest,finalAgentSeq:end});expect(request.journalAuthority).toBe(f.binding.journalAuthority);expect(f.usage()).toBe(before);
});
it('rejects a missing retained event even when numeric cursor and final high-water row remain',()=>{
 const f=ready(0);const {key}=begin(f);expect(f.store.execute({kind:'getOutputRetirementRequest',key})).toMatchObject({closure:{finalAgentSeq:2}});
 // Task-owned synthetic corruption: preserves the final row and every cursor counter.
 f.db.exec('DROP TRIGGER run_event_retained');f.db.prepare('DELETE FROM run_events WHERE seq=1').run();
 expect(()=>f.store.execute({kind:'getOutputRetirementRequest',key})).toThrow('unavailable');
});
it('captures only a scoped immutable key and binds worker replies before caller use',()=>{
 const f=ready(0);const {key}=begin(f);const operation={kind:'getOutputRetirementRequest' as const,key};const reply=f.store.execute(operation);
 expect(captureDeletionOperation(operation)).toEqual(operation);expect(captureDeletionReply(operation,reply)).toEqual(reply);
 expect(()=>captureDeletionOperation({...operation,closure:{kind:'absence'}})).toThrow();
 expect(()=>captureDeletionReply(operation,{...(reply as object),runId:uuid(999)})).toThrow();
});

it('keeps positively unsent deletion on the separate branch without fabricating an agent request',()=>{
 const f=claimsFixture();try{
  const run=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(run.runId)});
  const original=command({...f,key:run});f.store.execute({kind:'beginOutputDeletion',command:original});
  expect(()=>f.store.execute({kind:'getOutputRetirementRequest',key:{scope,id:original.id,runId:run.runId}})).toThrow('conflict');
 }finally{f.db.close();}
});
