import { vi } from 'vitest';
import { retirementFixture } from './retirement-fixture.js';
import { fixture } from '../backend-settlement/fixture.js';
import type { OutputDeletionMetadata,OutputDeletionSummary } from '../../src/ports/output-deletion-metadata.js';
import type { OutputSettlementMetadata,BackendSettlementResult } from '../../src/ports/output-settlement-metadata.js';
import type { RunnerSettlementGateway } from '../../src/ports/runner-settlement.js';
import { hash } from '../output-deletion/cleanup-ack/fixture.js';
/** Actual backend transaction with synthetic agent replies, isolated fake native file lane. */
export function settlementFixture(){
 const f=retirementFixture();vi.useRealTimers();const source=fixture(0);
 const candidate=source.store.execute({kind:'getOutputDeletion',key:source.key}) as OutputDeletionSummary;
 f.retirement.scanRetirements.mockResolvedValue({items:[],nextCursor:null});let applied=false;
 const metadata={scanSettlements:vi.fn<OutputDeletionMetadata['scanSettlements']>(async()=>({items:applied?[]:[candidate],nextCursor:null})),
  reserveControl:vi.fn(async()=>candidate),retirementRequest:vi.fn(async()=>source.release.retirement),
  cleanupAck:vi.fn<OutputDeletionMetadata['cleanupAck']>(async()=>source.read() as Awaited<ReturnType<OutputDeletionMetadata['cleanupAck']>>)};
 const store={settle:vi.fn<OutputSettlementMetadata['settle']>(async request=>{
  const result=source.store.execute({kind:'settleBackendOutput',request}) as BackendSettlementResult;applied=true;return result;
 }),read:vi.fn<OutputSettlementMetadata['read']>(async key=>source.store.execute({kind:'readBackendSettlement',key}) as Awaited<ReturnType<OutputSettlementMetadata['read']>>)};
 const gateway={settleOutput:vi.fn<RunnerSettlementGateway['settleOutput']>(async()=>({ok:true,value:source.request.agentReply}))};
 vi.useFakeTimers();return{...f,source,candidate,settlement:metadata,settlementStore:store,settlementGateway:gateway,
  options:{...f.options,settlement:{metadata,store,gateway,digest:hash}}};
}
