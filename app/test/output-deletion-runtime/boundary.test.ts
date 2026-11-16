import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import {fixture,deferred} from './fixture.js';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>vi.useRealTimers());
it.each(['scope','run','ordinal','deletion','phase','plan'] as const)('rejects a mismatched %s row before native effects',async field=>{
 const f=fixture();const file=f.current();const r=file.record;const binding=r.binding;const key=binding.key;const other='00000000-0000-4000-8000-000000000999';
 const changes={scope:{...file,record:{...r,binding:{...binding,key:{...key,attempt:{...key.attempt,workspaceId:other}}}}},
  run:{...file,record:{...r,binding:{...binding,key:{...key,runId:other}}}},ordinal:{...file,record:{...r,artifact:{...r.artifact,ordinal:1}}},
  deletion:{...file,deletionId:other},phase:{...file,version:2},plan:{...file,namespaceIdentity:'b'.repeat(64)}};
 f.metadata.getFile.mockResolvedValue(changes[field]);const runtime=f.start();await vi.advanceTimersByTimeAsync(0);
 expect(f.files.prepareRemoval).not.toHaveBeenCalled();expect(f.files.remove).not.toHaveBeenCalled();expect(f.onFailure).toHaveBeenCalledTimes(1);await expect(runtime.close()).rejects.toThrow();
});
it('refuses a discovery that exceeds the admitted one-intent page',async()=>{
 const f=fixture();f.metadata.scan.mockResolvedValue({items:[f.summary,f.summary],nextCursor:null});const runtime=f.start();await vi.advanceTimersByTimeAsync(0);
 expect(f.metadata.getFile).not.toHaveBeenCalled();await expect(runtime.close()).rejects.toThrow();
});
it('keeps the original fixed budget through a held discovery and issues no late file operation',async()=>{
 const f=fixture();const held=deferred<Awaited<ReturnType<typeof f.metadata.scan>>>();f.metadata.scan.mockReturnValue(held.promise);
 const runtime=f.start();await vi.advanceTimersByTimeAsync(31000);expect(f.onFailure).toHaveBeenCalledTimes(1);
 const closed=vi.fn();const closing=runtime.close();const observed=expect(closing).rejects.toThrow('Deletion deadline');void closing.then(closed,closed);
 await vi.advanceTimersByTimeAsync(100);expect(closed).not.toHaveBeenCalled();held.resolve({items:[f.summary],nextCursor:null});await observed;
 expect(f.metadata.getFile).not.toHaveBeenCalled();expect(f.onFailure).toHaveBeenCalledTimes(1);
});
