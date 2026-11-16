import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { afterEach,expect,it,vi } from 'vitest';
import { pendingRunHistoryMetrics } from '@beetle/contracts/api';
import { captureSettlementRequest,settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import type { RunHistoryStore,RunHistoryMetricReader,RunHistoryProjection } from '../../src/ports/run-history.js';
import type { OutputCleanupAck } from '../../src/ports/output-deletion-metadata.js';
import { HistorySummaries } from '../../src/adapters/outbound/sqlite/run-history/index.js';
import { StorageError } from '../../src/adapters/outbound/sqlite/protocol.js';
import { startRunHistoryIndexer } from '../../src/application/run-history-index/index.js';
import { ready,begin,scope,uuid } from '../output-deletion/fixture.js';
import { cleaned,hash } from '../output-deletion/cleanup-ack/fixture.js';
function setup(){
 vi.useRealTimers();const claims=claimsFixture(4000000);const first=ready(0,{claims,id:70});const second=ready(0,{claims,id:71});const history=new HistorySummaries(first.db);
 const store:RunHistoryStore={
  scan:async query=>history.execute({kind:'historySummary',operation:{method:'scan',query}}) as Awaited<ReturnType<RunHistoryStore['scan']>>,
  retirement:async job=>history.execute({kind:'historySummary',operation:{method:'retirement',request:{job}}}) as Awaited<ReturnType<RunHistoryStore['retirement']>>,
  defer:async request=>history.execute({kind:'historySummary',operation:{method:'defer',request}}) as Awaited<ReturnType<RunHistoryStore['defer']>>,
  commit:async request=>history.execute({kind:'historySummary',operation:{method:'commit',request}}) as Awaited<ReturnType<RunHistoryStore['commit']>>,
 };
 const settle=()=>{
  const deletion=begin(first);const retirement=first.store.execute({kind:'getOutputRetirementRequest',key:deletion.key}) as RetirementRequest;
  const ack=first.store.execute({kind:'recordOutputCleanupAck',request:{key:deletion.key,reply:cleaned(retirement)}}) as OutputCleanupAck;
  const request=captureSettlementRequest({version:1,retirement,cleanupReplyDigest:ack.replyDigest});
  const agentReply={version:1 as const,state:'settled' as const,requestDigest:settlementRequestDigest(request,hash),cleanupReplyDigest:ack.replyDigest,tombstoneDigest:'d'.repeat(64),chargedBytes:4096 as const};
  first.store.execute({kind:'settleBackendOutput',request:{key:deletion.key,agentReply}});
 };
 return{first,second,store,settle};
}
const unavailable=():RunHistoryProjection=>({...pendingRunHistoryMetrics(),availability:'unavailable'});
const closes:(()=>Promise<void>)[]=[];
afterEach(async()=>{for(const close of closes.splice(0))await close();vi.useRealTimers();});
it.each(['summary','missing'] as const)('skips a held %s projection after actual settlement and indexes the next Run',async kind=>{
 const f=setup();let resolve!:(value:RunHistoryProjection)=>void;let reject!:(error:unknown)=>void;
 const held=new Promise<RunHistoryProjection>((yes,no)=>{resolve=yes;reject=no;});const read=vi.fn<RunHistoryMetricReader['readRunHistorySummary']>(async()=>unavailable()).mockReturnValueOnce(held);
 const onFailure=vi.fn(async()=>{});vi.useFakeTimers();
 const index=startRunHistoryIndexer({store:f.store,metrics:{readRunHistorySummary:read},intervalMs:25,onFailure});closes.push(()=>index.close());
 await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(1);f.settle();
 if(kind==='summary')resolve(unavailable());else reject(new StorageError('not_found'));
 await vi.advanceTimersByTimeAsync(25);expect(index.state().status).toBe('running');expect(onFailure).not.toHaveBeenCalled();
 expect(f.first.db.prepare('SELECT history_summary_json FROM runs WHERE id=?').get(f.second.key.runId)?.history_summary_json).toBeTypeOf('string');
});
it('returns explicit permanent retirement for stale defer and refuses unrelated missing or conflicting identity',async()=>{
 const f=setup();const jobs=await f.store.scan({nowMs:Date.now(),limit:2});const job=jobs[0]!;f.settle();
 expect(await f.store.defer({job,dueMs:Date.now()+1000})).toEqual({state:'retired',id:job.id,scope:job.scope,attemptId:job.attemptId});
 expect(await f.store.retirement({...job,scope:{...scope,workspaceId:uuid(999)}})).toBeNull();
 await expect(f.store.defer({job:{...job,attemptId:uuid(999)},dueMs:Date.now()+1000})).rejects.toMatchObject({code:'not_found'});
 await expect(f.store.defer({job:{...jobs[1]!,sourceDigest:'f'.repeat(64)},dueMs:Date.now()+1000})).rejects.toMatchObject({code:'conflict'});
});
it('defers an exact pending deletion before new metric reads so later Runs continue indexing',async()=>{
 const f=setup();begin(f.first);const before=f.first.usage();const read=vi.fn<RunHistoryMetricReader['readRunHistorySummary']>(async()=>unavailable());const onFailure=vi.fn(async()=>{});vi.useFakeTimers();
 const index=startRunHistoryIndexer({store:f.store,metrics:{readRunHistorySummary:read},intervalMs:25,onFailure});closes.push(()=>index.close());
 await vi.advanceTimersByTimeAsync(25);expect(read).toHaveBeenCalledTimes(1);
 expect(read.mock.calls[0]![0]).toMatchObject({id:f.second.key.runId});expect(f.first.usage()).toBe(before);
 expect(index.state().status).toBe('running');expect(onFailure).not.toHaveBeenCalled();
});
