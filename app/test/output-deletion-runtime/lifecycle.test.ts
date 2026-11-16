import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fixture,deferred} from './fixture.js';
import {OutputByteError} from '../../src/ports/output-bytes.js';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
const tick=(ms=0)=>vi.advanceTimersByTimeAsync(ms);
it('persists the actual preparation before a later removal and stops discovering absent files',async()=>{
 const f=fixture();const runtime=f.start();await tick();
 expect(f.metadata.recordPlan).toHaveBeenCalledExactlyOnceWith({key:{scope:f.summary.scope,id:f.summary.id,runId:f.summary.runId,ordinal:0},expectedVersion:1,plan:f.plan});
 expect(f.files.remove).not.toHaveBeenCalled();await tick(25);
 expect(f.files.remove.mock.calls[0]![0]).toEqual(f.plan);expect(f.metadata.recordAbsence).toHaveBeenCalledTimes(1);
 await tick(100);expect(f.files.remove).toHaveBeenCalledTimes(1);expect(f.onFailure).not.toHaveBeenCalled();await runtime.close();
});
it('owns metadata originals and aborts before any further native effect on shutdown',async()=>{
 const f=fixture();const held=deferred<Awaited<ReturnType<typeof f.metadata.getFile>>>();f.metadata.getFile.mockReturnValue(held.promise);
 const runtime=f.start();await tick();const closed=vi.fn();const closing=runtime.close().then(closed);await tick(100);expect(closed).not.toHaveBeenCalled();
 held.resolve(f.current());await closing;expect(f.files.prepareRemoval).not.toHaveBeenCalled();expect(f.onFailure).not.toHaveBeenCalled();
});
it('keeps preparation custody until result and settlement, and never writes a plan after cancellation',async()=>{
 const f=fixture();const quiet=deferred();f.files.prepareRemoval.mockImplementation(()=>({result:Promise.resolve(f.plan),settled:quiet.promise}));
 const runtime=f.start();await tick(100);expect(f.metadata.recordPlan).not.toHaveBeenCalled();expect(f.files.prepareRemoval).toHaveBeenCalledTimes(1);
 const closed=vi.fn();const closing=runtime.close().then(closed);await tick(100);expect(closed).not.toHaveBeenCalled();quiet.resolve();await closing;
 expect(f.metadata.recordPlan).not.toHaveBeenCalled();expect(f.files.remove).not.toHaveBeenCalled();
});
it('reports a permanent negative immediately while retaining the unsettled native original',async()=>{
 const f=fixture();const quiet=deferred();f.files.prepareRemoval.mockImplementation(()=>({result:Promise.reject(new OutputByteError('integrity')),settled:quiet.promise}));
 const runtime=f.start();await tick();expect(f.onFailure).toHaveBeenCalledTimes(1);
 const closing=runtime.close();const observed=expect(closing).rejects.toMatchObject({code:'integrity'});await tick(100);expect(f.metadata.recordPlan).not.toHaveBeenCalled();
 quiet.resolve();await observed;expect(runtime.close()).toBe(closing);
});
it('retains a rejected quiescence owner and never turns it into successful close',async()=>{
 const f=fixture();f.files.prepareRemoval.mockImplementation(()=>({result:Promise.resolve(f.plan),settled:Promise.reject(Error('Unknown native close'))}));
 const runtime=f.start();await tick();expect(f.onFailure).toHaveBeenCalledTimes(1);const done=vi.fn();void runtime.close().then(done,done);await tick(100);
 expect(done).not.toHaveBeenCalled();expect(f.metadata.recordPlan).not.toHaveBeenCalled();expect(f.files.prepareRemoval).toHaveBeenCalledTimes(1);
});
it('defers busy native admission without duplicate work or hiding other failures',async()=>{
 const f=fixture();f.files.prepareRemoval.mockImplementationOnce(()=>({result:Promise.reject(new OutputByteError('busy')),settled:Promise.resolve()}));
 const runtime=f.start();await tick();expect(f.onFailure).not.toHaveBeenCalled();await tick(25);expect(f.metadata.recordPlan).toHaveBeenCalledTimes(1);
 await tick(25);expect(f.current().phase).toBe('absent');await runtime.close();
});
it('recovers a lost committed plan reply from the exact durable row after restart',async()=>{
 const f=fixture();const save=f.metadata.recordPlan.getMockImplementation()!;
 f.metadata.recordPlan.mockImplementationOnce(async()=>{await save();throw Error('Lost plan reply');});
 const first=f.start();await tick();expect(f.current().phase).toBe('prepared');await expect(first.close()).rejects.toThrow('Lost plan reply');
 const second=f.start();await tick();expect(f.files.prepareRemoval).toHaveBeenCalledTimes(1);expect(f.files.remove.mock.calls[0]![0]).toEqual(f.plan);
 expect(f.current().phase).toBe('absent');await second.close();
});
