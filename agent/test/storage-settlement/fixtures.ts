import { fixture as pipelineFixture } from '../retirement-pipeline/fixtures.js';
import { cleanupAccess } from '../../src/cleanup-access/index.js';
import { cleanedReplyDigest } from '@beetle/contracts/output-settlement';
import { retirementDigest } from '../../src/retirement-values/index.js';
import { initialize } from '../../src/journal/schema.js';
import { purgeOrder } from '../../src/journal/settlements/purge-order.js';
import type { DatabaseSync } from 'node:sqlite';
export function fixture(){
 const f=pipelineFixture();return{...f,async cleaned(){
  const e=await f.pipeline();const work=e.pipeline.tickWithPorts(e.request,{deadline:performance.now()+10000},e.ports);
  const cleaned=await work.result;await work.settled;if(cleaned.state!=='cleaned')throw Error('Not cleaned');
  const fence=cleanupAccess(e.owner.retirements).reserve(e.request);const observation=await fence.drain();
  const request={version:1 as const,retirement:e.request,cleanupReplyDigest:cleanedReplyDigest(cleaned,e.request,retirementDigest)};
  return{...e,cleaned,fence,observation,request};
 }};
}
export function snapshot(db:DatabaseSync){
 const tables=[...purgeOrder,'agent_replay_storage','retired_attempts','disk_retention_stats','admission_settings'] as const;
 return tables.map(name=>({name,rows:db.prepare(`SELECT * FROM ${name}`).all()}));
}
export async function offline(e:{owner:{close():Promise<void>};journalPath:string}){
 await e.owner.close();return initialize(e.journalPath);
}
