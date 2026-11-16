import {expect,it} from 'vitest';
import {encodeCanonicalJson} from '@beetle/contracts';
import {captureRuntimeAssociation,runtimeAssociationBytes} from '../../src/runtime-association/index.js';
import {cleanupControl,cleanupPayloadBytes} from '../../src/cleanup-control/index.js';
export function maximum(){
 return {version:1,purpose:'performance',original:{organizationId:'ffffffff-ffff-4fff-8fff-ffffffffffff',workspaceId:'ffffffff-ffff-4fff-8fff-ffffffffffff',attemptId:'ffffffff-ffff-4fff-8fff-ffffffffffff',generation:1,intentDigest:'a'.repeat(64)},
  retirementRequestDigest:'b'.repeat(64),namespaceIdentity:'c'.repeat(64),taskNamespaceIdentity:'d'.repeat(64),daemonId:'D'.repeat(128),runtimeId:'e'.repeat(64),specDigest:'f'.repeat(64),mailboxName:'a'.repeat(128)};
}
it('fits all maximal supported fields plus the row in the explicit2048-byte cell without increasing C1 reservation',()=>{
 const value=captureRuntimeAssociation(maximum());const bytes=Buffer.byteLength(encodeCanonicalJson(value,runtimeAssociationBytes));
 expect(bytes+512).toBeLessThanOrEqual(cleanupControl.runtimeAssociationBytes);expect(cleanupControl.runtimeAssociationBytes).toBe(2048);
 expect(cleanupControl.reservedBytes).toBe(196608);expect(cleanupPayloadBytes).toBe(169984);expect(cleanupControl.reservedBytes-cleanupPayloadBytes).toBe(26624);
});
it.each(['daemon','mailbox','digest','scope','extra'] as const)('rejects over-bound/invalid %s before worker/native dispatch',field=>{
 const value=maximum();const invalid={daemon:{...value,daemonId:'a'.repeat(129)},mailbox:{...value,mailboxName:'a'.repeat(129)},digest:{...value,specDigest:'z'.repeat(64)},scope:{...value,original:{...value.original,generation:2}},extra:{...value,path:'/foreign'}};
 expect(()=>captureRuntimeAssociation(invalid[field])).toThrow();
});
