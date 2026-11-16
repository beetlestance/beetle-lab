import { claimsFixture } from '../../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../../storage/run-cancellation-fixtures.js';
import { expect,it } from 'vitest';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { OutputCleanupAck,OutputCleanupAckState } from '../../../src/ports/output-deletion-metadata.js';
import { fixture,cleaned,preserved,hash } from './fixture.js';
import { absenceFixture } from '../../output-absence/fixture.js';
import { command,scope,uuid } from '../fixture.js';
it('records one immutable exact ACK, replays canonical values, and preserves every old authority/charge',()=>{
 const f=fixture();expect(f.read()).toEqual({kind:'missing'});const before=preserved(f);const reply=cleaned(f.request());
 const ack=f.record(reply) as OutputCleanupAck;expect(ack).toEqual({version:1,reply,replyDigest:hash(encodeCanonicalJson(reply,4096)),logicalBytes:Buffer.byteLength(encodeCanonicalJson(reply,4096))+512});
 expect(f.record({...reply})).toEqual(ack);expect(f.read()).toEqual({kind:'stored',ack});expect(preserved(f)).toBe(before);
 expect(f.db.prepare('SELECT count(*) n FROM backend_output_cleanup_acks').get()?.n).toBe(1);
 if(reply.state!=='cleaned')throw Error('Fixture');expect(()=>f.record({...reply,cleanupReceiptDigest:'d'.repeat(64)})).toThrow('conflict');expect(preserved(f)).toBe(before);
});
it('requires all captured backend file receipts before accepting a producer reply',()=>{
 const f=fixture(1);expect(f.read()).toEqual({kind:'missing'});
 // The wire identity is a synthetic valid reply; incomplete file custody still refuses.
 const source=fixture();expect(()=>f.record(cleaned(source.request()))).toThrow();expect(f.read()).toEqual({kind:'missing'});
 f.finishFiles();expect(f.record()).toMatchObject({reply:{state:'cleaned'}});
});
it.each(['pending','requestDigest','journalAuthority','runId','deletionId','intentDigest','workspaceId','extra'] as const)('rejects %s without committing metadata or refund',field=>{
 const f=fixture();const value={...cleaned(f.request())} as Record<string,unknown>;
 if(field==='pending'){value.state='pending';delete value.namespaceIdentity;delete value.preparationIdentity;delete value.cleanupReceiptDigest;}
 else if(field==='extra')value.path='/untrusted';else value[field]=field.endsWith('Digest')?'f'.repeat(64):uuid(999);
 const before=preserved(f);expect(()=>f.record(value as never)).toThrow();expect(f.read()).toEqual({kind:'missing'});expect(preserved(f)).toBe(before);
});
it.each([0,2])('retains exact absence closure at sequence%s without inventing source bytes',end=>{
 const f=absenceFixture({end});f.ready();f.finalize();const original=command(f);f.store.execute({kind:'beginOutputDeletion',command:original});
 const key={scope,id:original.id,runId:f.key.runId};const request=f.store.execute({kind:'getOutputRetirementRequest',key}) as ReturnType<ReturnType<typeof fixture>['request']>;
 const before=f.usage();const ack=f.store.execute({kind:'recordOutputCleanupAck',request:{key,reply:cleaned(request)}}) as OutputCleanupAck;
 expect(ack.reply.state).toBe('cleaned');expect(f.usage()).toBe(before);
});
it('binds scoped reads and returns missing only for a known deletion',()=>{
 const f=fixture();f.record();expect(()=>f.store.execute({kind:'getOutputCleanupAck',key:{...f.key,scope:{...scope,organizationId:uuid(999)}}})).toThrow('not_found');
 expect(()=>f.store.execute({kind:'getOutputCleanupAck',key:{...f.key,id:uuid(999)}})).toThrow('not_found');
 expect((f.read() as OutputCleanupAckState).kind).toBe('stored');
});

it('refuses to fabricate agent ACKs for positively unsent deletion',()=>{
 const f=claimsFixture();try{const run=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(run.runId)});const original=command({...f,key:run});
  f.store.execute({kind:'beginOutputDeletion',command:original});const key={scope,id:original.id,runId:run.runId};const source=fixture();
  expect(()=>f.store.execute({kind:'recordOutputCleanupAck',request:{key,reply:cleaned(source.request())}})).toThrow('conflict');
  expect(f.store.execute({kind:'getOutputCleanupAck',key})).toEqual({kind:'missing'});expect(f.db.prepare('SELECT count(*) n FROM backend_output_cleanup_acks').get()?.n).toBe(0);
 }finally{f.db.close();}
});

it('does not fabricate or top up a lost control reservation while accepting an ACK',()=>{
 const f=fixture();const reply=cleaned(f.request());f.db.exec('DROP TRIGGER cleanup_control_retained;DELETE FROM backend_cleanup_controls');const before=preserved(f);
 expect(()=>f.record(reply)).toThrow('capacity_unavailable');expect(f.read()).toEqual({kind:'missing'});expect(preserved(f)).toBe(before);
});
