import { expect,it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import request from '../../../contracts/fixtures/valid/output-retirement-absence.json' with {type:'json'};
import reply from '../../../contracts/fixtures/valid/output-retirement-reply-absence-cleaned.json' with {type:'json'};
import { cleanedReplyDigest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import { agentChargeNames,captureAgentTombstone,agentTombstoneDigest } from '../../src/settlement-values/index.js';
import { retirementDigest } from '../../src/retirement-values/index.js';
const expected={version:1 as const,retirement:request,cleanupReplyDigest:cleanedReplyDigest(reply,request,retirementDigest)};
function original(){return{version:2,offerDigest:'f'.repeat(64),settlementRequestDigest:settlementRequestDigest(expected,retirementDigest),reply,
 charges:{...Object.fromEntries(agentChargeNames.map(name=>[name,0])),absenceBytes:512},disk:{outputBytes:0,stagingBytes:0},
 funding:{kind:'rejected_control',reservedBytes:16384},chargedBytes:4096};}
it('fits maximum-width v2 accounting into the same prepaid permanent bucket',()=>{
 const base=original();const part=Math.floor(Number.MAX_SAFE_INTEGER/4);
 const value={...base,charges:{...base.charges,spoolBytes:part,snapshotBytes:part,checkpointBytes:part,absenceBytes:part}};
 const captured=captureAgentTombstone(value,expected);const text=encodeCanonicalJson(captured,3584);
 expect(Buffer.byteLength(text)+512).toBeLessThanOrEqual(4096);expect(captured.version).toBe(2);
 expect(agentTombstoneDigest(value,expected)).toBe(agentTombstoneDigest(JSON.parse(text) as unknown,expected));
});
it.each([{version:1},{extra:true},{funding:{kind:'hold',reservedBytes:16384}},{funding:{kind:'rejected_control',reservedBytes:0}},
 {disk:{outputBytes:1,stagingBytes:65536}},{chargedBytes:0}])('rejects cross-funding claims and hidden metadata %j',patch=>{
 expect(()=>captureAgentTombstone({...original(),...patch},expected)).toThrow();
});
it('refuses fake C1/hold/native charges, missing closure charge and charge overflow',()=>{
 const value=original();for(const charges of [{...value.charges,cleanupControlBytes:196608},{...value.charges,holdBytes:512},
  {...value.charges,sourceBytes:1},{...value.charges,absenceBytes:0},{...value.charges,spoolBytes:Number.MAX_SAFE_INTEGER}]){
  expect(()=>captureAgentTombstone({...value,charges},expected)).toThrow();
 }
});
