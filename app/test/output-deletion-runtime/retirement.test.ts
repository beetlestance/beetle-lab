import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {ClientResult} from '@beetle/contracts';
import type {RetirementReply} from '@beetle/contracts/output-retirement';
import {startOutputDeletionRuntime} from '../../src/application/output-deletion-runtime/index.js';
import {retirementFixture} from './retirement-fixture.js';
import {deferred} from './fixture.js';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it('uses the exact original and records one cleaned ACK before resuming file work',async()=>{
 const f=retirementFixture();f.retirement.scanRetirements.mockResolvedValueOnce({items:[f.summary],nextCursor:null}).mockResolvedValue({items:[],nextCursor:null});
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(0);
 expect(f.gateway.retireOutput).toHaveBeenCalledWith(f.request,expect.any(AbortSignal));
 expect(f.retirement.recordCleanupAck).toHaveBeenCalledWith({key:{id:f.summary.id,runId:f.summary.runId,scope:f.summary.scope},reply:f.reply});
 expect(f.files.prepareRemoval).not.toHaveBeenCalled();await vi.advanceTimersByTimeAsync(25);
 expect(f.files.prepareRemoval).toHaveBeenCalledTimes(1);await runtime.close();
});
it('defers validated pending without ACK or starvation of the file lane',async()=>{
 const f=retirementFixture();f.gateway.retireOutput.mockResolvedValue({ok:true,value:f.pending});
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(100);
 expect(f.retirement.recordCleanupAck).not.toHaveBeenCalled();expect(f.files.remove).toHaveBeenCalled();expect(f.onFailure).not.toHaveBeenCalled();await runtime.close();
});
it('advances an empty eligible page and preserves its retirement cursor',async()=>{
 const f=retirementFixture();f.retirement.scanRetirements.mockResolvedValueOnce({items:[],nextCursor:'cursor'});
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(50);
 expect(f.retirement.scanRetirements).toHaveBeenNthCalledWith(2,{limit:32,cursor:'cursor'});await runtime.close();
});
it('defers capacity refusal before request or agent work',async()=>{
 const f=retirementFixture();f.retirement.reserveControl.mockRejectedValue(Object.assign(Error('capacity'),{code:'capacity_unavailable'}));
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(50);
 expect(f.gateway.retireOutput).not.toHaveBeenCalled();expect(f.retirement.retirementRequest).not.toHaveBeenCalled();expect(f.files.prepareRemoval).toHaveBeenCalled();await runtime.close();
});
it('paces transient transport failures without fencing or blocking file progress',async()=>{
 const f=retirementFixture();f.gateway.retireOutput.mockResolvedValue({ok:false,error:{kind:'transport'}} as never);
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(999);
 expect(f.gateway.retireOutput).toHaveBeenCalledTimes(1);expect(f.files.remove).toHaveBeenCalled();expect(f.onFailure).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(51);expect(f.gateway.retireOutput).toHaveBeenCalledTimes(2);await runtime.close();
});
it.each(['request','response','protocol','cancelled'] as const)('fences permanent or unqualified %s replies without ACK',async kind=>{
 const f=retirementFixture();f.gateway.retireOutput.mockResolvedValue({ok:false,error:{kind}} as never);
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(0);
 expect(f.retirement.recordCleanupAck).not.toHaveBeenCalled();expect(f.onFailure).toHaveBeenCalledTimes(1);await expect(runtime.close()).rejects.toThrow();
});
it('holds close through an actual gateway carrier and does not ACK a late reply',async()=>{
 const f=retirementFixture();const held=deferred<ClientResult<RetirementReply>>();f.gateway.retireOutput.mockReturnValue(held.promise as never);
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(0);const closed=vi.fn();const closing=runtime.close().then(closed);
 await vi.advanceTimersByTimeAsync(100);expect(closed).not.toHaveBeenCalled();held.resolve({ok:true,value:f.reply});await closing;
 expect(f.retirement.recordCleanupAck).not.toHaveBeenCalled();
});
it('holds the exact ACK write through deadline and uncertain rejection before close can reject',async()=>{
 const f=retirementFixture();let reject!:(error:unknown)=>void;const held={promise:new Promise<Awaited<ReturnType<typeof f.retirement.recordCleanupAck>>>((_resolve,fail)=>{reject=fail;})};f.retirement.recordCleanupAck.mockReturnValue(held.promise);
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(30001);expect(f.onFailure).toHaveBeenCalledTimes(1);
 const closed=vi.fn();const closing=runtime.close();const rejected=expect(closing).rejects.toThrow('Deletion deadline');void closing.then(closed,closed);
 await vi.advanceTimersByTimeAsync(100);expect(closed).not.toHaveBeenCalled();reject(Error('unknown commit'));await rejected;
 expect(f.retirement.recordCleanupAck).toHaveBeenCalledTimes(1);
});
it('requires an explicit isolated file-only mode or retirement capability',()=>{
 const f=retirementFixture();expect(()=>startOutputDeletionRuntime({...f.options,fileOnly:true})).toThrow('mode');
 const {retirement,...options}=f.options;void retirement;expect(()=>startOutputDeletionRuntime(options)).toThrow('mode');
});
it('skips an unfunded candidate and reaches another funded original in the same horizon',async()=>{
 const f=retirementFixture();const blocked={...f.summary,id:'00000000-0000-4000-8000-000000000999'};
 f.retirement.scanRetirements.mockResolvedValueOnce({items:[blocked,f.summary],nextCursor:null});
 f.retirement.reserveControl.mockRejectedValueOnce(Object.assign(Error('capacity'),{code:'capacity_unavailable'}));
 const runtime=startOutputDeletionRuntime(f.options);await vi.advanceTimersByTimeAsync(0);expect(f.gateway.retireOutput).not.toHaveBeenCalled();
 await vi.advanceTimersByTimeAsync(50);expect(f.retirement.scanRetirements).toHaveBeenCalledTimes(1);expect(f.gateway.retireOutput).toHaveBeenCalledTimes(1);
 expect(f.retirement.recordCleanupAck).toHaveBeenCalledTimes(1);await runtime.close();
});
it('reserves file cleanup capacity before preparing or removing a backend file',async()=>{
 const f=retirementFixture();f.metadata.reserveControl.mockRejectedValue(Object.assign(Error('capacity'),{code:'capacity_unavailable'}));
 const runtime=startOutputDeletionRuntime({...f.options,metadata:f.metadata});await vi.advanceTimersByTimeAsync(100);
 expect(f.files.prepareRemoval).not.toHaveBeenCalled();expect(f.files.remove).not.toHaveBeenCalled();expect(f.onFailure).not.toHaveBeenCalled();await runtime.close();
});
