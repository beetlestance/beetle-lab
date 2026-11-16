import {expect,it} from 'vitest';
import {DatabaseSync} from 'node:sqlite';
import {captureStandaloneExportAssignment,estimateStaging} from '@beetle/contracts';
import {prepareExportCancellation} from '../../src/application/exports/index.js';
import {storageFixture,seed,scope,uuid,requestId,digest} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {runCommand} from '../storage/runs-fixture.js';
import {options,createCommand} from './fixture.js';
const f=storageFixture();
it('persists a separate exact assignment and replays its original queued response before changed eligibility',async()=>{
 const path=f.path();let metadata=await f.open(path,options());await seed(metadata);
 const body=request();body.config.secrets=[];const revision=await append(metadata,await createSuite(metadata),60,body);
 const command=createCommand(revision.id);const job=await metadata.exports.create(command);
 expect(job).toMatchObject({state:'queued',sourceProfileId:'standard',engine:{profileId:'standard-export'},artifact:null});
 expect(await metadata.exports.get({scope,id:job.id})).toEqual(job);
 const cancellation=prepareExportCancellation({kind:'cancelExport',id:job.id,request:{scope,requestId:requestId()}},digest);
 expect(await metadata.exports.cancel(cancellation)).toMatchObject({state:'cancelled',cancellationRequested:true});
 await f.close(metadata);const db=new DatabaseSync(path);
 try{
  expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()?.n).toBe(0);
  const row=db.prepare('SELECT j.*,o.assignment_json FROM export_jobs j JOIN export_originals o ON o.export_id=j.id').get()!;const assignment=captureStandaloneExportAssignment(JSON.parse(String(row.assignment_json)),digest);
  expect(assignment).toMatchObject({purpose:'standalone_export',exportId:job.id,source:{revisionId:revision.id,revisionDigest:revision.digest},offer:{config:revision.config}});
  expect(row.staging_bytes).toBe(estimateStaging(assignment.offer,assignment).totalBytes);
  expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(3145728);
  expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 }finally{db.close();}
 metadata=await f.open(path,{runtime:null,runs:{profiles:[],pendingLimit:1}});
 expect(await metadata.exports.create(createCommand(revision.id,501,command.request))).toEqual(job);
 expect(await metadata.exports.cancel(cancellation)).toMatchObject({state:'cancelled'});
 await expect(metadata.exports.create(createCommand(revision.id,502,{...command.request,options:{...command.request.options,scriptTimeoutMs:100}}))).rejects.toMatchObject({code:'conflict'});
});
it('shares the bounded pending queue with Runs and keeps scoped/query-bound pagination',async()=>{
 const metadata=await f.open(undefined,options(2));await seed(metadata);await seed(metadata,11,12,13);
 const body=request();body.config.secrets=[];const revision=await append(metadata,await createSuite(metadata),60,body);
 await metadata.runs.execute(runCommand(revision.id));const job=await metadata.exports.create(createCommand(revision.id));
 await expect(metadata.exports.create(createCommand(revision.id,501))).rejects.toMatchObject({code:'queue_full'});
 await expect(metadata.runs.execute(runCommand(revision.id,71))).rejects.toMatchObject({code:'queue_full'});
 const foreign={...scope,organizationId:uuid(11),workspaceId:uuid(12)};
 await expect(metadata.exports.get({scope:foreign,id:job.id})).rejects.toMatchObject({code:'not_found'});
 expect((await metadata.exports.list({scope,limit:1})).items.map(item=>item.id)).toEqual([job.id]);
});
it('refuses secret-bearing revisions before inserting a job, charge, order or request receipt',async()=>{
 const path=f.path();const metadata=await f.open(path,options());await seed(metadata);
 const body=request();body.config.secrets=[{name:'TOKEN',provider:'env',locator:'_SYNTHETIC',version:'v1'}];
 const revision=await append(metadata,await createSuite(metadata),60,body);
 await expect(metadata.exports.create(createCommand(revision.id))).rejects.toMatchObject({code:'invalid_value'});
 await f.close(metadata);const db=new DatabaseSync(path);try{
  expect(db.prepare('SELECT COUNT(*) AS n FROM export_jobs').get()?.n).toBe(0);
  expect(db.prepare('SELECT COUNT(*) AS n FROM execution_orders').get()?.n).toBe(0);
  expect(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(0);
 }finally{db.close();}
});
