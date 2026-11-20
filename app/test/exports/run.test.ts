import {expect,it} from 'vitest';
import {EXPORT_CONTROL_BYTES,EXPORT_RESULT_BYTES} from '@beetle/contracts';
import {createRunExport,RUN_EXPORT_SCRIPT_BYTES} from '../../src/application/exports/index.js';
import type {CreateRunExportOperation} from '../../src/application/exports/index.js';
import {storageFixture,seed,scope,uuid,requestId,digest} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {runCommand,runRequest} from '../storage/runs-fixture.js';
import {options} from './fixture.js';
const f=storageFixture();
async function prepared(outputBytes=300000){
 const metadata=await f.open(f.path(),options());await seed(metadata);const body=request();body.config.secrets=[];
 const revision=await append(metadata,await createSuite(metadata),60,body);const base=runRequest(revision.id);
 const run=await metadata.runs.execute(runCommand(revision.id,70,{...base,budget:{...base.budget,outputBytes}}));
 return {metadata,run};
}
const operation=(runId:string,request:CreateRunExportOperation['request'],id=500):CreateRunExportOperation=>
 ({kind:'createRunExport',runId,id:uuid(id),attemptId:uuid(id+1000),requestedAt:'2026-11-12T00:00:00.000Z',request});
it('exports the run revision, profile, budget and policy, and replays one receipt for one request ID',async()=>{
 const {metadata,run}=await prepared();const body={scope,requestId:requestId()};
 const job=await createRunExport({operation:operation(run.id,body),digest,runs:metadata.runs,store:metadata.exports});
 expect(job).toMatchObject({scope,revisionId:run.revisionId,sourceProfileId:run.engine.profileId,budget:run.budget,
  executionPolicy:run.executionPolicy,state:'queued',options:{scriptTimeoutMs:run.budget.timeoutMs,
   maximumBuildBytes:Math.min(RUN_EXPORT_SCRIPT_BYTES,run.budget.outputBytes-EXPORT_CONTROL_BYTES-EXPORT_RESULT_BYTES)}});
 const replay=await createRunExport({operation:operation(run.id,body,600),digest,runs:metadata.runs,store:metadata.exports});
 expect(replay).toEqual(job);
});
it('keeps explicit options and refuses options the run budget cannot hold',async()=>{
 const {metadata,run}=await prepared();const own={scriptTimeoutMs:60000,maximumBuildBytes:4096};
 const job=await createRunExport({operation:operation(run.id,{scope,requestId:requestId(),options:own}),digest,runs:metadata.runs,store:metadata.exports});
 expect(job.options).toEqual(own);
 await expect(createRunExport({operation:operation(run.id,{scope,requestId:requestId(),options:{...own,maximumBuildBytes:run.budget.outputBytes}},700),
  digest,runs:metadata.runs,store:metadata.exports})).rejects.toMatchObject({code:'invalid_value'});
});
it('treats a run outside the requested workspace as not found and creates nothing',async()=>{
 const {metadata,run}=await prepared();const other={...scope,workspaceId:uuid(999)};
 await expect(createRunExport({operation:operation(run.id,{scope:other,requestId:requestId()}),digest,runs:metadata.runs,store:metadata.exports}))
  .rejects.toMatchObject({code:'not_found'});
 expect((await metadata.exports.list({scope,limit:10})).items).toEqual([]);
});
