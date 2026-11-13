import { claimsFixture } from '../dispatch-claim-fixtures.js';
import { cancelCommand } from '../run-cancellation-fixtures.js';
import { command } from '../../output-deletion/fixture.js';
import { expect,it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import { backendSettlementCredit,captureBackendTombstone,backendTombstoneDigest,BACKEND_TOMBSTONE_JSON_BYTES } from '../../../src/adapters/outbound/sqlite/settlement-values/index.js';
function original(kind:'source'|'absence'|'unsent'='source'){
 const id='ffffffff-ffff-4fff-8fff-ffffffffffff';const hash='f'.repeat(64);const sent=kind!=='unsent';
 const value={version:1,organizationId:id,workspaceId:id,runId:id,attemptId:id,deletionId:id,
  runVersion:Number.MAX_SAFE_INTEGER,intentDigest:hash,closureDigest:sent?hash:null,kind,
  retainedPayloadBytes:sent?Number.MAX_SAFE_INTEGER-131072:0,metadataBytes:sent?65536:0,cleanupBytes:65536,
  cleanupReplyDigest:sent?hash:null,agentTombstoneDigest:sent?hash:null,settlementRequestDigest:sent?hash:null,
  refundedBytes:0,chargedBytes:2560};
 return{...value,refundedBytes:backendSettlementCredit(value)};
}
it.each(['source','absence','unsent'] as const)('fits complete maximum-width %s tombstone and exact credit',kind=>{
 const value=captureBackendTombstone(original(kind));const json=encodeCanonicalJson(value,BACKEND_TOMBSTONE_JSON_BYTES);
 expect(Buffer.byteLength(json)+512).toBeLessThanOrEqual(2560);expect(Object.isFrozen(value)).toBe(true);
 expect(value.refundedBytes).toBe(kind==='unsent'?65536-2560:Number.MAX_SAFE_INTEGER-2560);
 expect(backendTombstoneDigest(value)).toBe(backendTombstoneDigest(JSON.parse(json) as unknown));
});
it.each([{version:2},{extra:1},{kind:'unknown'},{runId:'invalid'},{runVersion:0},{runVersion:1.5},
 {intentDigest:'A'.repeat(64)},{cleanupReplyDigest:null},{settlementRequestDigest:'invalid'},
 {cleanupBytes:0},{metadataBytes:0},{chargedBytes:0},{refundedBytes:0},
 {retainedPayloadBytes:Number.MAX_SAFE_INTEGER},{retainedPayloadBytes:-1}])('rejects malformed or contradictory debt %j',patch=>{
 expect(()=>captureBackendTombstone({...original(),...patch})).toThrow();
});
it('keeps the positive unsent branch separate from physical ACK semantics',()=>{
 const value=original('unsent');
 expect(()=>captureBackendTombstone({...value,cleanupReplyDigest:'f'.repeat(64)})).toThrow();
 expect(()=>captureBackendTombstone({...value,closureDigest:'f'.repeat(64)})).toThrow();
 expect(()=>captureBackendTombstone({...original(),closureDigest:null})).toThrow();
 expect(()=>captureBackendTombstone({...value,retainedPayloadBytes:1})).toThrow();
 expect(()=>captureBackendTombstone({...value,metadataBytes:65536})).toThrow();
});
it('never credits the historical maximum a second time',()=>{
 const credit=backendSettlementCredit({kind:'source',retainedPayloadBytes:12,metadataBytes:65536,cleanupBytes:65536});
 expect(credit).toBe(128524);
 // The caller must supply current finalization facts, not the immutable old allocation.
 expect(()=>backendSettlementCredit({kind:'source',retainedPayloadBytes:Infinity,metadataBytes:65536,cleanupBytes:65536})).toThrow();
});
it('bounds hostile input and distinguishes immutable settlement identities',()=>{
 const value=original();let calls=0;
 expect(()=>captureBackendTombstone({...value,get extra(){calls++;return 1;}})).toThrow();expect(calls).toBe(0);
 expect(()=>captureBackendTombstone({...value,extra:'🪲'.repeat(2048)})).toThrow();
 expect(backendTombstoneDigest(value)).not.toBe(backendTombstoneDigest({...value,closureDigest:'a'.repeat(64)}));
});

it('represents the actual positive unsent deletion witness without inventing a closure digest',()=>{
 const f=claimsFixture();try{
  const key=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(key.runId)});
  f.store.execute({kind:'beginOutputDeletion',command:command({...f,key})});
  const row=f.db.prepare(`SELECT d.organization_id organizationId,d.workspace_id workspaceId,
   d.run_id runId,d.attempt_id attemptId,d.id deletionId,d.run_version runVersion,
   a.intent_digest intentDigest,d.closure_digest closureDigest,d.kind,
   d.retained_payload_bytes retainedPayloadBytes,d.metadata_bytes metadataBytes,c.reserved_bytes cleanupBytes
   FROM output_deletion_intents d JOIN attempts a ON a.id=d.attempt_id
   JOIN backend_cleanup_controls c ON c.attempt_id=d.attempt_id WHERE d.attempt_id=?`).get(key.attempt.attemptId);
  expect(row).toMatchObject({kind:'unsent',closureDigest:null,retainedPayloadBytes:0,metadataBytes:0,cleanupBytes:65536});
  const value=captureBackendTombstone({...row,version:1,cleanupReplyDigest:null,agentTombstoneDigest:null,
   settlementRequestDigest:null,refundedBytes:Number(row?.cleanupBytes)-2560,chargedBytes:2560});
  expect(value.refundedBytes).toBe(62976);expect(value.runId).toBe(key.runId);
  expect(f.db.prepare('SELECT count(*) n FROM attempt_output_allocations').get()?.n).toBe(0);
 }finally{f.db.close();}
});
