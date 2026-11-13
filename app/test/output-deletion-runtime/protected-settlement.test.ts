import { afterEach,expect,it,vi } from 'vitest';
import type { OutputDeletionMetadata,OutputDeletionSummary } from '../../src/ports/output-deletion-metadata.js';
import type { OutputSettlementMetadata } from '../../src/ports/output-settlement-metadata.js';
import { startOutputDeletionRuntime } from '../../src/application/output-deletion-runtime/index.js';
import { retirementFixture } from './retirement-fixture.js';
import { absenceFixture } from '../output-absence/fixture.js';
import { claimsFixture } from '../storage/dispatch-claim-fixtures.js';
import { cancelCommand } from '../storage/run-cancellation-fixtures.js';
import { command } from '../output-deletion/fixture.js';
import { hash } from '../output-deletion/cleanup-ack/fixture.js';
import type { Store } from '../../src/adapters/outbound/sqlite/store.js';
afterEach(()=>vi.useRealTimers());
function ports(store:Store){
 const metadata:Pick<OutputDeletionMetadata,'scanRetirements'|'scanSettlements'|'reserveControl'|'retirementRequest'|'recordCleanupAck'|'cleanupAck'>={
  scanRetirements:async query=>store.execute({kind:'scanOutputRetirements',query}) as Awaited<ReturnType<OutputDeletionMetadata['scanRetirements']>>,
  scanSettlements:async query=>store.execute({kind:'scanOutputSettlements',query}) as Awaited<ReturnType<OutputDeletionMetadata['scanSettlements']>>,
  reserveControl:async key=>store.execute({kind:'reserveOutputCleanupControl',key}) as OutputDeletionSummary,
  retirementRequest:async key=>store.execute({kind:'getOutputRetirementRequest',key}) as Awaited<ReturnType<OutputDeletionMetadata['retirementRequest']>>,
  recordCleanupAck:async request=>store.execute({kind:'recordOutputCleanupAck',request}) as Awaited<ReturnType<OutputDeletionMetadata['recordCleanupAck']>>,
  cleanupAck:async key=>store.execute({kind:'getOutputCleanupAck',key}) as Awaited<ReturnType<OutputDeletionMetadata['cleanupAck']>>,
 };
 const settlements:OutputSettlementMetadata={settle:async request=>store.execute({kind:'settleBackendOutput',request}) as Awaited<ReturnType<OutputSettlementMetadata['settle']>>,
  read:async key=>store.execute({kind:'readBackendSettlement',key}) as Awaited<ReturnType<OutputSettlementMetadata['read']>>};
 return{metadata,settlements};
}
it('discovers rejected absence but preserves debt while agent cleanup is unavailable',async()=>{
 const f=retirementFixture();vi.useRealTimers();const source=absenceFixture({admission:{state:'rejected',reason:'per_run_ceiling'},reason:'budget_unavailable'});
 source.ready();source.finalize();const deletion=command(source);source.store.execute({kind:'beginOutputDeletion',command:deletion});const before=source.usage();
 const p=ports(source.store);f.gateway.retireOutput.mockResolvedValue({ok:false,error:{kind:'transport'}});const settleOutput=vi.fn(async():Promise<never>=>{throw Error('Protected original dispatched');});
 f.metadata.scan.mockResolvedValue({items:[],nextCursor:null});vi.useFakeTimers();
 const runtime=startOutputDeletionRuntime({...f.options,metadata:f.metadata,
  retirement:{metadata:p.metadata,gateway:f.gateway,digest:hash},settlement:{metadata:p.metadata,store:p.settlements,gateway:{settleOutput},digest:hash}});
 await vi.advanceTimersByTimeAsync(250);
 expect(f.gateway.retireOutput).toHaveBeenCalled();expect(settleOutput).not.toHaveBeenCalled();expect(f.onFailure).not.toHaveBeenCalled();
 expect(source.usage()).toBe(before);expect(source.db.prepare('SELECT count(*) n FROM output_deletion_intents').get()?.n).toBe(1);await runtime.close();
});
it('automatically settles actual unsent cancellation with no agent call',async()=>{
 const f=retirementFixture();vi.useRealTimers();const source=claimsFixture();
 try{
  const run=source.add();source.store.execute({kind:'cancelRun',command:cancelCommand(run.runId)});const deletion=command({...source,key:run});
  source.store.execute({kind:'beginOutputDeletion',command:deletion});const p=ports(source.store);
  const settleOutput=vi.fn(async():Promise<never>=>{throw Error('Unsent original dispatched');});f.metadata.scan.mockResolvedValue({items:[],nextCursor:null});vi.useFakeTimers();
  const runtime=startOutputDeletionRuntime({...f.options,metadata:f.metadata,
   retirement:{metadata:p.metadata,gateway:f.gateway,digest:hash},settlement:{metadata:p.metadata,store:p.settlements,gateway:{settleOutput},digest:hash}});
  await vi.advanceTimersByTimeAsync(100);expect(source.db.prepare('SELECT count(*) n FROM runs').get()?.n).toBe(0);
  expect(source.db.prepare('SELECT charged_bytes FROM backend_replay_storage').get()?.charged_bytes).toBe(2560);
  expect(f.gateway.retireOutput).not.toHaveBeenCalled();expect(settleOutput).not.toHaveBeenCalled();expect(f.onFailure).not.toHaveBeenCalled();await runtime.close();
 }finally{vi.useRealTimers();source.db.close();}
});
