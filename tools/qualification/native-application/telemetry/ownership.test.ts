import {expect,it,vi} from 'vitest';
import {closeGroup,closeOrdered} from './ownership.js';
it('does not release enclosing custody after a dependent close rejects',async()=>{
 const parent=vi.fn();await expect(closeOrdered([()=>Promise.reject(Error('child')),parent])).rejects.toThrow('child');expect(parent).not.toHaveBeenCalled();
});
it('retains sibling original ownership until every issued close settles even after another fails',async()=>{
 let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});let settled=false;
 const result=closeGroup([()=>Promise.reject(Error('failed')),()=>held]).then(()=>{settled=true;},error=>{settled=true;throw error;});
 void result.catch(()=>undefined);await Promise.resolve();await Promise.resolve();expect(settled).toBe(false);
 release();await expect(result).rejects.toThrow('Telemetry sibling owners failed to drain');expect(settled).toBe(true);
});
