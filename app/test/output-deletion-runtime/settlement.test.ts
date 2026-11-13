import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import type { ClientResult } from '@beetle/contracts';
import type { SettlementReply } from '@beetle/contracts/output-settlement';
import { startOutputDeletionRuntime } from '../../src/application/output-deletion-runtime/index.js';
import { settlementFixture } from './settlement-fixture.js';
import { deferred } from './fixture.js';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('reconciles one exact source instruction then atomically settles backend debt while other lanes progress',async()=>{
 const f=settlementFixture();const before=f.source.usage();const runtime=startOutputDeletionRuntime(f.options);
 await vi.advanceTimersByTimeAsync(25);
 expect(f.settlementGateway.settleOutput).toHaveBeenCalledWith(f.source.release,expect.any(AbortSignal));
 expect(f.settlementStore.settle).toHaveBeenCalledWith(f.source.request);expect(f.source.usage()).toBeLessThan(before);
 expect(f.source.db.prepare('SELECT count(*) n FROM runs').get()?.n).toBe(0);
 await vi.advanceTimersByTimeAsync(100);expect(f.files.remove).toHaveBeenCalled();await runtime.close();
});
it('preserves every backend charge and paces unknown agent delivery without stopping file work',async()=>{
 const f=settlementFixture();const before=f.source.usage();f.settlementGateway.settleOutput.mockResolvedValue({ok:false,error:{kind:'transport'}});
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(999);
 expect(f.settlementGateway.settleOutput).toHaveBeenCalledTimes(1);expect(f.settlementStore.settle).not.toHaveBeenCalled();
 expect(f.source.usage()).toBe(before);expect(f.files.remove).toHaveBeenCalled();expect(f.onFailure).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(100);expect(f.settlementGateway.settleOutput).toHaveBeenCalledTimes(2);await runtime.close();
});
it('holds an issued gateway through shutdown and preserves backend debt after a late successful agent reply',async()=>{
 const f=settlementFixture();const held=deferred<ClientResult<SettlementReply>>();f.settlementGateway.settleOutput.mockReturnValue(held.promise);
 const before=f.source.usage();const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(25);
 let closed=false;const closing=runtime.close().then(()=>{closed=true;});await vi.advanceTimersByTimeAsync(100);expect(closed).toBe(false);
 held.resolve({ok:true,value:f.source.request.agentReply});await closing;
 expect(f.settlementStore.settle).not.toHaveBeenCalled();expect(f.source.usage()).toBe(before);
});
it('holds an already-issued backend credit through shutdown without treating cancellation as rollback',async()=>{
 const f=settlementFixture();const settle=f.settlementStore.settle.getMockImplementation()!;const held=deferred<Awaited<ReturnType<typeof settle>>>();
 f.settlementStore.settle.mockImplementation(async request=>{const value=await settle(request);return await held.promise.then(()=>value);});
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(25);expect(f.source.db.prepare('SELECT count(*) n FROM runs').get()?.n).toBe(0);
 let closed=false;const closing=runtime.close().then(()=>{closed=true;});await vi.advanceTimersByTimeAsync(100);expect(closed).toBe(false);
 held.resolve(await settle(f.source.request));await closing;expect(f.source.db.prepare('SELECT original_count FROM backend_replay_storage').get()?.original_count).toBe(1);
});
it('advances empty physical pages and skips a capacity-refused candidate',async()=>{
 const f=settlementFixture();f.settlement.scanSettlements.mockResolvedValueOnce({items:[],nextCursor:'cursor'});
 f.settlement.reserveControl.mockRejectedValueOnce(Object.assign(Error('full'),{code:'capacity_unavailable'}));
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(175);
 expect(f.settlement.scanSettlements).toHaveBeenNthCalledWith(2,{limit:32,cursor:'cursor'});
 expect(f.settlementGateway.settleOutput).toHaveBeenCalledTimes(1);await runtime.close();
});
it('fences permanent identity refusals without granting credit',async()=>{
 const f=settlementFixture();f.settlementGateway.settleOutput.mockResolvedValue({ok:false,error:{kind:'response',status:200}});
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(25);
 expect(f.settlementStore.settle).not.toHaveBeenCalled();expect(f.onFailure).toHaveBeenCalledTimes(1);await expect(runtime.close()).rejects.toThrow();
});
