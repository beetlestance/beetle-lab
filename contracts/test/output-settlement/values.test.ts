import { createHash } from 'node:crypto';
import { expect,it } from 'vitest';
import source from '../../fixtures/valid/output-retirement-source.json' with {type:'json'};
import absence from '../../fixtures/valid/output-retirement-absence.json' with {type:'json'};
import cleaned from '../../fixtures/valid/output-retirement-reply-source-cleaned.json' with {type:'json'};
import pending from '../../fixtures/valid/output-retirement-reply-source-pending.json' with {type:'json'};
import { encodeCanonicalJson } from '../../src/json.js';
import { captureSettlementRequest, captureSettlementReply, cleanedReplyDigest, settlementRequestDigest,
  SETTLEMENT_REPLY_BYTES } from '../../src/output-settlement/index.js';
const digest = (text:string) => createHash('sha256').update(text).digest('hex');
const request = {version:1 as const,retirement:source,cleanupReplyDigest:digest(encodeCanonicalJson(cleaned,4096))};
const reply = {version:1 as const,state:'settled' as const,requestDigest:settlementRequestDigest(request,digest),
  cleanupReplyDigest:request.cleanupReplyDigest,tombstoneDigest:'a'.repeat(64),chargedBytes:4096 as const};
it('binds stable closed request/reply values and preserves immutable intake',()=>{
 const copy=structuredClone(request);const value=captureSettlementRequest(copy);
 copy.retirement.attemptId='invalid';expect(value.retirement.attemptId).toBe(source.attemptId);
 expect(Object.isFrozen(value.retirement.closure)).toBe(true);
 expect(cleanedReplyDigest(cleaned,source,digest)).toBe(request.cleanupReplyDigest);
 expect(captureSettlementReply(reply,request,digest)).toEqual(reply);
 expect(Buffer.byteLength(encodeCanonicalJson(reply,SETTLEMENT_REPLY_BYTES))).toBeLessThanOrEqual(SETTLEMENT_REPLY_BYTES);
 expect(settlementRequestDigest({...request,retirement:absence},digest)).not.toBe(reply.requestDigest);
});
it.each([{version:2},{path:'/tmp/native'},{retirement:{...source,purpose:'standalone_export'}},
 {cleanupReplyDigest:'A'.repeat(64)},{cleanupReplyDigest:'a'.repeat(63)}])('rejects malformed request %j',patch=>{
 expect(()=>captureSettlementRequest({...request,...patch})).toThrow();
});
it.each([{version:2},{state:'pending'},{chargedBytes:0},{chargedBytes:4097},{tombstoneDigest:'invalid'},
 {requestDigest:'b'.repeat(64)},{cleanupReplyDigest:'c'.repeat(64)},{extra:'hidden'}])('rejects malformed or mismatched reply %j',patch=>{
 expect(()=>captureSettlementReply({...reply,...patch},request,digest)).toThrow();
});
it('refuses a pending cleanup or mismatched original and invalid digest provider',()=>{
 expect(()=>cleanedReplyDigest(pending,source,digest)).toThrow();
 expect(()=>cleanedReplyDigest(cleaned,absence,digest)).toThrow();
 expect(()=>settlementRequestDigest(request,()=> 'invalid')).toThrow();
 expect(()=>captureSettlementReply(reply,{...request,retirement:absence},digest)).toThrow();
});
it('bounds intake before serialization and never invokes a hostile getter',()=>{
 let calls=0;const hostile={...request,get extra(){calls++;return 'hidden';}};
 expect(()=>captureSettlementRequest(hostile)).toThrow();expect(calls).toBe(0);
 expect(()=>captureSettlementRequest({...request,extra:'🪲'.repeat(4000)})).toThrow();
 expect(()=>captureSettlementReply({...reply,extra:'🪲'.repeat(4000)},request,digest)).toThrow();
});
