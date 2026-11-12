import { bindSyntheticNamespace } from '../staging-namespace/model-fixtures.js';
import { cleanupControl } from '../../src/cleanup-control/index.js';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { expect, it } from 'vitest';
import { createStandaloneExportAssignment, estimateStaging, validate } from '@beetle/contracts';
import type { Offer, StandaloneExportAssignment } from '@beetle/contracts';
import { admissionFixture, configuration, observation, validation, scope, now, reserved } from '../admission/fixtures.js';
import type { Journal } from '../../src/journal/index.js';
const f=admissionFixture();const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
function assignment(offer:Offer,timeout=60000):StandaloneExportAssignment {
  return createStandaloneExportAssignment({version:1,purpose:'standalone_export',exportId:'00000000-0000-4000-8000-000000000031',
    requestId:'00000000-0000-4000-8000-000000000032',source:{revisionId:'00000000-0000-4000-8000-000000000033',revisionDigest:'c'.repeat(64)},
    offer,options:{scriptTimeoutMs:timeout,maximumBuildBytes:100000}},hash);
}
function job(id=1){const offer=f.job(id);offer.budget.outputBytes=300000;offer.requiredCapabilities=['standalone-export-v1'];offer.secretReferences=[];return offer;}
async function configured(path?:string){
  const journal=await f.open(path);await bindSyntheticNamespace(journal);const config=configuration();config.pool.outputBytes=2000000;config.perRun.outputBytes=1000000;
  config.profiles[0]!.capabilities.push('standalone-export-v1');await journal.admission({kind:'configure',configuration:config});
  const observed=observation();observed.capacity.outputBytes=2000000;await journal.admission({kind:'observe',observation:observed});return journal;
}
function enqueue(journal:Journal,value:StandaloneExportAssignment){return journal.admission({kind:'offer',offer:value.offer,assignment:value,validation:validation(value.offer),now});}
it('durably retains exact purpose through lost-caller-reply replay and reopen, refusing changed or missing purpose',async()=>{
  let stage='configure'; try {
  const path=f.path();let journal=await configured(path);const value=assignment(job());
  stage='enqueue/admit';await enqueue(journal,value);const admitted=reserved(await f.admit(journal,value.offer));
  expect(admitted.staging.assignmentBytes).toBe(Buffer.byteLength(JSON.stringify(value)));
  expect(admitted.resources.stagingBytes).toBe(estimateStaging(value.offer).totalBytes+Buffer.byteLength(JSON.stringify(value)));
  stage='read assignment';expect((await journal.readExportAssignment(scope(value.offer)))?.assignmentDigest).toBe(value.assignmentDigest);
  stage='snapshot/reopen';const before=await journal.get(scope(value.offer));await f.close(journal);journal=await f.open(path);
  stage='replay';await enqueue(journal,value);expect(await journal.get(scope(value.offer))).toEqual(before);
  await expect(enqueue(journal,assignment(value.offer,90000))).rejects.toMatchObject({code:'conflict'});
  await expect(journal.admission({kind:'offer',offer:value.offer,validation:validation(value.offer),now})).rejects.toMatchObject({code:'invalid_input'});
  expect(await journal.get(scope(value.offer))).toEqual(before);
  } catch(error){throw new Error(stage,{cause:error});}
});
it('refuses an assignment attached to a different nested Offer before accepting either original',async()=>{
  const journal=await configured();const value=assignment(job());const offer={...value.offer,config:{changed:true}};
  await expect(journal.admission({kind:'offer',offer,assignment:value,validation:validation(offer),now})).rejects.toMatchObject({code:'invalid_input'});
  await expect(journal.get(scope(value.offer))).rejects.toMatchObject({code:'not_found'});
});
it('never attaches export purpose to a prior performance receipt with the same nested bytes',async()=>{
  const journal=await configured();const value=assignment(job());await journal.immutableOffer(value.offer);
  await expect(enqueue(journal,value)).rejects.toMatchObject({code:'conflict'});
  expect(await journal.readExportAssignment(scope(value.offer))).toBeNull();
});
it('retains the full assignment with a durable known admission refusal',async()=>{
  const journal=await f.configured();const value=assignment(job());await enqueue(journal,value);
  expect((await journal.get(scope(value.offer))).admission?.state).toBe('rejected');
  expect(await journal.readExportAssignment(scope(value.offer))).toEqual(value);
});
it('rejects secret declarations and old Offer envelope intake before durable mutation',async()=>{
  const journal=await configured();const offer=job();offer.secretReferences=[{name:'TOKEN',provider:'env',reference:'TOKEN',version:'v1'}];
  expect(()=>assignment(offer)).toThrow();await expect(journal.get(scope(offer))).rejects.toMatchObject({code:'not_found'});
  expect(validate('Offer',assignment(job())).ok).toBe(false);
});

it('SQL guards refuse replacement and late purpose attachment even with recursive triggers disabled',async()=>{
  const path=f.path();const journal=await configured(path);const value=assignment(job());await enqueue(journal,value);await f.admit(journal,value.offer);
  const priorPerformance=job(2);await journal.immutableOffer(priorPerformance);await f.close(journal);
  const db=new DatabaseSync(path);try {
    db.exec('PRAGMA foreign_keys=ON; PRAGMA recursive_triggers=OFF');
    const read=()=>db.prepare('SELECT * FROM export_assignments WHERE attempt_id=?').get(value.offer.attemptId);
    const before=read();const reservation=db.prepare('SELECT reservation_json,charged FROM reservations WHERE attempt_id=?').get(value.offer.attemptId);
    const altered=assignment(value.offer,90000);
    expect(()=>db.prepare('INSERT OR REPLACE INTO export_assignments VALUES (?,?,?)').run(value.offer.attemptId,altered.assignmentDigest,JSON.stringify(altered))).toThrow('existing_export_assignment');
    expect(read()).toEqual(before);expect(db.prepare('SELECT reservation_json,charged FROM reservations WHERE attempt_id=?').get(value.offer.attemptId)).toEqual(reservation);
    const attached=assignment(priorPerformance);
    expect(()=>db.prepare('INSERT INTO export_assignments VALUES (?,?,?)').run(priorPerformance.attemptId,attached.assignmentDigest,JSON.stringify(attached))).toThrow('export_assignment_original');
    expect(()=>db.prepare("UPDATE accepted_attempts SET execution_purpose='standalone_export' WHERE attempt_id=?").run(priorPerformance.attemptId)).toThrow('immutable_execution_purpose');
    expect(db.prepare('SELECT execution_purpose FROM accepted_attempts WHERE attempt_id=?').get(priorPerformance.attemptId)?.execution_purpose).toBe('performance');
  } finally {db.close();}
});

it('durably cancels a missing exact export before late admission without creating a reservation',async()=>{
  const journal=await configured();const value=assignment(job());const key=scope(value.offer);
  const first=await journal.cancelExportOriginal({assignment:value,now});expect(first.cancelRequested).toBe(true);
  expect(await journal.readExportAssignment(key)).toEqual(value);
  expect(await enqueue(journal,value)).toEqual({kind:'reject',reason:'cancelled'});
  await expect(journal.admission({kind:'reservation',key})).rejects.toMatchObject({code:'not_found'});
  await expect(journal.cancelExportOriginal({assignment:assignment(value.offer,90000),now})).rejects.toMatchObject({code:'conflict'});
  expect(await journal.get(key)).toEqual(first);
});

it('reserves the same non-refundable logical cleanup capacity for an admitted export original', async () => {
  const path = f.path(); const journal = await configured(path); const value = assignment(job());
  await enqueue(journal, value); reserved(await f.admit(journal, value.offer)); await f.close(journal);
  const db = new DatabaseSync(path);
  try {
    const row = db.prepare('SELECT cleanup_control_bytes,staging_namespace_identity,execution_purpose FROM accepted_attempts').get()!;
    expect(row.cleanup_control_bytes).toBe(cleanupControl.reservedBytes); expect(row.execution_purpose).toBe('standalone_export');
    expect(String(row.staging_namespace_identity)).toMatch(/^[a-f0-9]{64}$/);
  } finally { db.close(); }
});
