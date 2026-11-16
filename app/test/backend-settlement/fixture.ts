import { fixture as ackFixture } from '../output-deletion/cleanup-ack/fixture.js';
import { captureSettlementRequest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import { hash } from '../output-deletion/cleanup-ack/fixture.js';
import type { BackendSettlementResult } from '../../src/ports/output-settlement-metadata.js';
export function fixture(count=1){
 const f=ackFixture(count);f.finishFiles();const ack=f.record();
 if(!ack||!('replyDigest' in ack))throw Error('Missing ACK');
 const release=captureSettlementRequest({version:1,retirement:f.request(),cleanupReplyDigest:ack.replyDigest});
 const agentReply={version:1 as const,state:'settled' as const,requestDigest:settlementRequestDigest(release,hash),
  cleanupReplyDigest:release.cleanupReplyDigest,tombstoneDigest:'d'.repeat(64),chargedBytes:4096 as const};
 const request={key:f.key,agentReply};const operation={kind:'settleBackendOutput' as const,request};
 return{...f,release,request,operation,settle:()=>f.store.execute(operation) as BackendSettlementResult};
}
export function snapshot(f:ReturnType<typeof fixture>){
 const tables=f.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all();
 return JSON.stringify(tables.map(({name})=>({name,rows:f.db.prepare(`SELECT * FROM ${name} LIMIT 130`).all()})));
}
