import { createHash } from 'node:crypto';
import { expect,it } from 'vitest';
import source from '../../../contracts/fixtures/valid/output-retirement-source.json' with {type:'json'};
import cleaned from '../../../contracts/fixtures/valid/output-retirement-reply-source-cleaned.json' with {type:'json'};
import { encodeCanonicalJson } from '@beetle/contracts';
import { cleanedReplyDigest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import { agentChargeNames,captureAgentTombstone,agentTombstoneDigest,AGENT_TOMBSTONE_JSON_BYTES } from '../../src/settlement-values/index.js';
import type { AgentCharges } from '../../src/settlement-values/index.js';
const digest=(text:string)=>createHash('sha256').update(text).digest('hex');
const request={version:1 as const,retirement:source,cleanupReplyDigest:cleanedReplyDigest(cleaned,source,digest)};
function original(){
 const charges=Object.fromEntries(agentChargeNames.map(name=>[name,0])) as unknown as AgentCharges;
 return{version:1,offerDigest:'f'.repeat(64),settlementRequestDigest:settlementRequestDigest(request,digest),
  reply:cleaned,charges:{...charges,holdBytes:512,cleanupControlBytes:196608},disk:{outputBytes:1,stagingBytes:65536},chargedBytes:4096};
}
it('fits a complete maximum-width record plus logical row allowance in its charged replay bucket',()=>{
 const value=original();const perField=Math.floor((Number.MAX_SAFE_INTEGER-196608)/8);
 for(const name of agentChargeNames)if(name!=='cleanupControlBytes')value.charges[name]=perField;
 value.disk={outputBytes:Number.MAX_SAFE_INTEGER,stagingBytes:Number.MAX_SAFE_INTEGER};
 const captured=captureAgentTombstone(value,request);const json=encodeCanonicalJson(captured,AGENT_TOMBSTONE_JSON_BYTES);
 expect(Buffer.byteLength(json)+512).toBeLessThanOrEqual(4096);
 expect(captured.charges).toEqual(value.charges);expect(Object.isFrozen(captured.charges)).toBe(true);
 expect(agentTombstoneDigest(captured,request)).toBe(agentTombstoneDigest(JSON.parse(json) as unknown,request));
});
it.each([{version:2},{extra:true},{offerDigest:'invalid'},{chargedBytes:0},{settlementRequestDigest:'a'.repeat(64)},
 {disk:{outputBytes:0,stagingBytes:65536}},{disk:{outputBytes:1,stagingBytes:4096}},
 {disk:{outputBytes:1,stagingBytes:65536,hidden:true}}])('rejects invalid compact metadata %j',patch=>{
 expect(()=>captureAgentTombstone({...original(),...patch},request)).toThrow();
});
it('refuses ambiguous or overflowing component accounting and a missing C1 reservation',()=>{
 const value=original();
 for(const charges of [{...value.charges,cleanupControlBytes:0},{...value.charges,spoolBytes:-1},
  {...value.charges,spoolBytes:Number.MAX_SAFE_INTEGER},{...value.charges,deliveryBytes:NaN},
  {...value.charges,extra:1},{cleanupControlBytes:196608}])expect(()=>captureAgentTombstone({...value,charges},request)).toThrow();
});
it('binds cleaned reply and original and bounds hostile intake without executing getters',()=>{
 const value=original();expect(()=>captureAgentTombstone({...value,reply:{...cleaned,cleanupReceiptDigest:'a'.repeat(64)}},request)).toThrow();
 expect(()=>captureAgentTombstone(value,{...request,retirement:{...source,runId:'00000000-0000-4000-8000-000000000999'}})).toThrow();
 let calls=0;expect(()=>captureAgentTombstone({...value,get hidden(){calls++;return 1;}},request)).toThrow();expect(calls).toBe(0);
 expect(()=>captureAgentTombstone({...value,hidden:'🪲'.repeat(4096)},request)).toThrow();
 expect(agentTombstoneDigest(value,request)).not.toBe(agentTombstoneDigest({...value,offerDigest:'a'.repeat(64)},request));
});
