import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import legacy from '../../../contracts/fixtures/api/valid/run.json' with {type:'json'};
import { captureRunRow } from '../../src/adapters/outbound/sqlite/run-row.js';
import { scope, seed, storageFixture, settingsCommand, requestId } from './fixture.js';
import { append, createSuite } from './suites-fixture.js';
import { runCommand, runOptions } from './runs-fixture.js';
const fixture=storageFixture();
it('captures the configured label atomically, preserves replay/restart and keeps it out of the engine Offer',async()=>{
 const path=fixture.path();let metadata=await fixture.open(path,runOptions());await seed(metadata);
 const revision=await append(metadata,await createSuite(metadata));
 const command=runCommand(revision.id);const first=await metadata.runs.execute(command);
 expect(first.requestedBy).toBe('Administrator');
 const before=await metadata.getSettings({kind:'installation'});
 await metadata.settings.execute(settingsCommand(before.id,{scope:{kind:'installation'},schemaVersion:2,requestId:requestId(),expectedVersion:before.version,patch:{administratorName:'Meera Ops'}}));
 const second=await metadata.runs.execute(runCommand(revision.id,71));
 expect(second.requestedBy).toBe('Meera Ops');
 expect(await metadata.runs.execute(command)).toEqual(first);
 expect((await metadata.runs.getRun({scope,id:first.id})).requestedBy).toBe('Administrator');
 expect((await metadata.runs.listRuns({scope,limit:10})).items.map(row=>row.requestedBy).sort()).toEqual(['Administrator','Meera Ops']);
 await fixture.close(metadata);
 const db=new DatabaseSync(path);
 try {
  const row=db.prepare('SELECT snapshot_json FROM runs WHERE id=?').get(second.id)!;
  expect(JSON.parse(String(row.snapshot_json)).requestedBy).toBe('Meera Ops');
  const offer=db.prepare('SELECT offer_json FROM attempts WHERE id=?').get(second.activeAttemptId)!;
  expect(String(offer.offer_json)).not.toContain('requestedBy');expect(String(offer.offer_json)).not.toContain('Meera Ops');
 } finally {db.close();}
 metadata=await fixture.open(path,runOptions());
 expect((await metadata.runs.getRun({scope,id:second.id})).requestedBy).toBe('Meera Ops');
 expect(await metadata.runs.execute(command)).toEqual(first);
});
it('preserves old snapshots without inventing an author and validates optional stored labels',()=>{
 const row={snapshot_json:JSON.stringify(legacy),state:legacy.state,outcome:legacy.outcome,validation_status:legacy.validationStatus,active_attempt_id:legacy.activeAttemptId,cancellation_requested:0,reason:null,version:legacy.version};
 const key={scope:{...legacy.scope,kind:'workspace' as const},id:legacy.id};
 expect(captureRunRow(row,key).requestedBy).toBeUndefined();
 expect(()=>captureRunRow({...row,snapshot_json:JSON.stringify({...legacy,requestedBy:'Bad\u0000name'})},key)).toThrow();
 expect(validateApi('Run',{...legacy,requestedBy:null}).ok).toBe(true);
 expect(validateApi('Run',{...legacy,requestedBy:'x'.repeat(129)}).ok).toBe(false);
});
it('rejects a caller attempting to supply the captured name',()=>{
 expect(validateApi('CreateRunRequest',{scope,requestId:requestId(),revisionId:legacy.revisionId,engineProfile:'standard',budget:legacy.budget,executionPolicy:legacy.executionPolicy,requestedBy:'Forged person'}).ok).toBe(false);
});
