import { createHash } from 'node:crypto';
import { expect,it } from 'vitest';
import source from '../../fixtures/valid/output-retirement-source.json' with {type:'json'};
import absence from '../../fixtures/valid/output-retirement-absence.json' with {type:'json'};
import sourcePending from '../../fixtures/valid/output-retirement-reply-source-pending.json' with {type:'json'};
import sourceCleaned from '../../fixtures/valid/output-retirement-reply-source-cleaned.json' with {type:'json'};
import absencePending from '../../fixtures/valid/output-retirement-reply-absence-pending.json' with {type:'json'};
import absenceCleaned from '../../fixtures/valid/output-retirement-reply-absence-cleaned.json' with {type:'json'};
import vector from '../../fixtures/output-retirement/reply-v1.json' with {type:'json'};
import { captureOutputRetirementReply,outputRetirementDigest,OUTPUT_RETIREMENT_REPLY_BYTES } from '../../src/output-retirement/index.js';
import { encodeCanonicalJson } from '../../src/json.js';
const digest=(input:string)=>createHash('sha256').update(input).digest('hex');
it.each([[source,sourcePending],[source,sourceCleaned],[absence,absencePending],[absence,absenceCleaned]])('captures exact closed request-bound reply %#',(request,reply)=>{
 const original=structuredClone(reply);const value=captureOutputRetirementReply(original,request,digest);expect(value).toEqual(reply);expect(Object.isFrozen(value)).toBe(true);
 expect(Buffer.byteLength(encodeCanonicalJson(value,OUTPUT_RETIREMENT_REPLY_BYTES))).toBeLessThanOrEqual(OUTPUT_RETIREMENT_REPLY_BYTES);
 original.state='changed';expect(value.state).toBe(reply.state);expect(value).not.toHaveProperty('path');expect(value).not.toHaveProperty('native');
});
it('matches independent canonical request digest vectors for both closure kinds',()=>{
 expect(outputRetirementDigest(source,digest)).toBe(vector.requests.source);expect(outputRetirementDigest(absence,digest)).toBe(vector.requests.absence);
});
it.each(['namespaceIdentity','preparationIdentity','cleanupReceiptDigest'])('pending rejects %s rather than dropping claimed closure',key=>{
 expect(()=>captureOutputRetirementReply({...sourcePending,[key]:'a'.repeat(64)},source,digest)).toThrow();
});
it.each(['organizationId','workspaceId','attemptId','journalAuthority','runId','deletionId'])('refuses crossed %s binding',key=>{
 expect(()=>captureOutputRetirementReply({...sourceCleaned,[key]:'00000000-0000-4000-8000-000000000999'},source,digest)).toThrow();
});
it.each([{generation:2},{deletionVersion:2},{retirementVersion:2},{purpose:'standalone_export'},{intentDigest:'f'.repeat(64)},
 {requestDigest:'f'.repeat(64)},{state:'complete'},{cleanupReceiptDigest:'X'.repeat(64)},{native:{closed:true}},{refundBytes:1}])('rejects malformed or authority-claiming reply %#',patch=>{
 expect(()=>captureOutputRetirementReply({...sourceCleaned,...patch},source,digest)).toThrow();
});
it('binds complete closure identity and preserves exact original/physical-authority spelling',()=>{
 expect(()=>captureOutputRetirementReply(sourceCleaned,{...source,closure:{...source.closure,finalAgentSeq:source.closure.finalAgentSeq+1}},digest)).toThrow();
 const upper={...source,organizationId:source.organizationId.toUpperCase(),journalAuthority:source.journalAuthority.toUpperCase()};
 expect(()=>captureOutputRetirementReply(sourceCleaned,upper,digest)).toThrow();
 const reply={...sourceCleaned,organizationId:upper.organizationId,journalAuthority:upper.journalAuthority,requestDigest:outputRetirementDigest(upper,digest)};
 expect(captureOutputRetirementReply(reply,upper,digest).journalAuthority).toBe(upper.journalAuthority);
});
it('bounds hostile input and refuses accessors without executing them',()=>{
 expect(()=>captureOutputRetirementReply({...sourceCleaned,padding:'🪲'.repeat(OUTPUT_RETIREMENT_REPLY_BYTES)},source,digest)).toThrow();let calls=0;
 const value=structuredClone(sourceCleaned);Object.defineProperty(value,'cleanupReceiptDigest',{enumerable:true,get(){calls++;return'f'.repeat(64);}});
 expect(()=>captureOutputRetirementReply(value,source,digest)).toThrow();expect(calls).toBe(0);
});
it('validates the trusted hasher output and does not imply physical permission',()=>{
 expect(()=>captureOutputRetirementReply(sourceCleaned,source,()=> 'invalid')).toThrow();
 expect(captureOutputRetirementReply(sourceCleaned,source,digest).state).toBe('cleaned');
 // A fixture passes syntax only. Production must obtain the state/digests from trusted finalization.
});
