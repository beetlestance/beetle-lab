import { expect,it } from 'vitest';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { observed } from '../output-absence/stopped-history-fixture.js';
import { absenceFixture } from '../output-absence/fixture.js';
import { command,scope } from '../output-deletion/fixture.js';
import { cleaned,hash } from '../output-deletion/cleanup-ack/fixture.js';
import { captureSettlementRequest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { OutputCleanupAck,OutputDeletionSummary } from '../../src/ports/output-deletion-metadata.js';
import type { BackendSettlementResult } from '../../src/ports/output-settlement-metadata.js';
it('settles positively unsent cancellation from its funded control only and never invents an agent ACK',()=>{
 const f=claimsFixture();try{
  const run=f.add();f.store.execute({kind:'cancelRun',command:cancelCommand(run.runId)});
  const deletion=command({...f,key:run});const progress=f.store.execute({kind:'beginOutputDeletion',command:deletion}) as OutputDeletionSummary;
  const key={scope,id:deletion.id,runId:run.runId};const before=f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes;
  expect(progress.kind).toBe('unsent');const operation={kind:'settleBackendOutput' as const,request:{key,agentReply:null}};
  const result=f.store.execute(operation) as BackendSettlementResult;
  expect(result).toMatchObject({kind:'unsent',refundedBytes:65536-2560,chargedBytes:2560});
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(Number(before)-65536+2560);
  expect(f.store.execute(operation)).toEqual(result);expect(f.db.prepare('SELECT count(*) n FROM runs').get()?.n).toBe(0);
 }finally{f.db.close();}
});
it.each([false,true])('settles admitted absence with retained history %s and exact cleaned/agent reply',withHistory=>{
 const f=absenceFixture();f.adopt();f.release({exitEvidence:{exitCode:137,oomKilled:true,observedAt:'2026-01-01T00:01:00Z'}});f.ingest();f.confirm();
 const history=withHistory?observed(f):undefined;
 expect(f.absences.execute({kind:'absenceFinalize',request:{...f.command(),...(history?{stoppedHistory:history}:{})}})).toMatchObject({kind:'finalized'});
 const retained=Number(f.cursor().retained_bytes)+(history?.bytes??0);const deletion=command(f);
 expect(f.store.execute({kind:'beginOutputDeletion',command:deletion})).toMatchObject({retainedPayloadBytes:retained});
 const key={scope,id:deletion.id,runId:f.key.runId};
 const retirement=f.store.execute({kind:'getOutputRetirementRequest',key});
 if(!retirement||!('closure' in retirement)||!('purpose' in retirement))throw Error('Missing retirement');
 const ack=f.store.execute({kind:'recordOutputCleanupAck',request:{key,reply:cleaned(retirement)}}) as OutputCleanupAck;
 const request=captureSettlementRequest({version:1,retirement,cleanupReplyDigest:ack.replyDigest});
 const agentReply={version:1 as const,state:'settled' as const,requestDigest:settlementRequestDigest(request,hash),
  cleanupReplyDigest:request.cleanupReplyDigest,tombstoneDigest:'d'.repeat(64),chargedBytes:4096 as const};
 const before=f.usage();const operation={kind:'settleBackendOutput' as const,request:{key,agentReply}};
 const result=f.store.execute(operation) as BackendSettlementResult;
 expect(result.kind).toBe('absence');expect(f.usage()).toBe(before-result.refundedBytes);
 expect(f.db.prepare('SELECT count(*) n FROM execution_stopped_history').get()?.n).toBe(0);
 const settled=f.usage();expect(f.store.execute(operation)).toEqual(result);expect(f.usage()).toBe(settled);
 expect(f.db.prepare('SELECT count(*) n FROM run_events').get()?.n).toBe(0);expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
