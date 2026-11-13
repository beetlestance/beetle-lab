import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { writeFile,chown,readdir } from 'node:fs/promises';
import { join } from 'node:path';
import type { Fixture } from '../../../../agent/test/container/fixture.js';
import { agentContainerArguments } from '../agent-container.js';
import { namespaceCaps } from '../../../../agent/src/staging-namespace/index.js';
import { digest } from '../../../../agent/test/container/fixture.js';
interface Owned {Id:string;Image:string;State:{Running:boolean;ExitCode:number};Config:{Labels:Record<string,string>}}
function replaceStopped(f:Fixture,seed:boolean):void{
 const current=f.docker.json<Owned[]>(['inspect',f.agent])[0]!;assert.equal(current.Config.Labels['dev.beetle.qualification'],f.id);
 assert.equal(current.Image,f.agentImage.Id);assert.equal(current.State.Running,false);assert.equal(current.State.ExitCode,0);
 f.docker.run(['rm',current.Id]);f.docker.run(agentContainerArguments(f,`beetle-control-${f.id}`,seed));f.docker.run(['start',f.agent]);
}
/** Actual Linux setup uses guards/native publisher/catalogue/policy; never raw grant SQL. */
export async function seedAdmittedNoTask(f:Fixture,canonical:string){
 const path=join(f.root,'config','seed-offer.json');await writeFile(path,canonical,{mode:0o600,flag:'wx'});await chown(path,f.uid,f.gid);
 f.docker.run(['stop','-t','10',f.agent]);replaceStopped(f,true);const status=f.docker.run(['wait',f.agent]);
 const state=f.docker.json<Owned[]>(['inspect',f.agent])[0]!;const logs=f.docker.logs(state.Id);await writeFile(join(f.root,'seed-logs.txt'),logs,{mode:0o600});
 assert.equal(status,'0','Seed must close every actual owner before restart');assert.equal(state.State.Running,false);assert.equal(state.State.ExitCode,0);
 const values=logs.split('\n').filter(line=>line.startsWith('{"state":"seeded"'));assert.equal(values.length,1);
 const result=JSON.parse(values[0]!) as {offerDigest:string;admission:unknown;task:string};assert.equal(result.offerDigest,digest(canonical));
 assert.deepEqual(result.admission,{state:'released',disposition:'never_started'});assert.equal(result.task,'none');
 const durable=inspectNeverStarted(f);assert.deepEqual(await readdir(join(f.root,'staging')),[namespaceCaps.markerName]);replaceStopped(f,false);
 return{setup:result,durable};
}
function inspectNeverStarted(f:Fixture){
 const db=new DatabaseSync(join(f.root,'journal','journal.sqlite'),{readOnly:true});
 try{
  const row=db.prepare(`SELECT cleanup_control_bytes,hold_bytes,last_seq,acknowledged_seq FROM accepted_attempts WHERE attempt_id=?`).get(f.offer.attemptId);assert(row);
  assert.equal(row.cleanup_control_bytes,196608);assert.equal(row.hold_bytes,512);assert.equal(row.last_seq,1);assert.equal(row.acknowledged_seq,0);
  const reservation=db.prepare("SELECT reservation_json FROM reservations WHERE attempt_id=? AND charged=0").get(f.offer.attemptId);assert(typeof reservation?.reservation_json==='string');
  const value=JSON.parse(reservation.reservation_json) as Record<string,unknown>;assert.equal(value.status,'released');assert.equal(value.aborted,true);assert.equal(value.launchClosed,true);assert.equal(value.launchEpoch,0);
  for(const key of ['createToken','startToken','runtimeId','specDigest','startClaimedAt','launchSettlement','releaseEvidence'])assert.equal(value[key],null);
  for(const table of ['task_staging_namespaces','runtime_cleanup_associations','output_no_task_cleanup_receipts','output_sources','rejected_cleanup_controls'])assert.equal(db.prepare(`SELECT count(*) n FROM ${table} WHERE attempt_id=?`).get(f.offer.attemptId)?.n,0);
  const hold=db.prepare("SELECT output_bytes,staging_bytes FROM disk_holds WHERE attempt_id=? AND phase='retained'").all(f.offer.attemptId);assert.equal(hold.length,1);
  assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);return{...row,disk:hold[0],aborted:true,createToken:null,runtimeId:null,taskRows:0,cleanupReceiptRows:0};
 }finally{db.close();}
}
