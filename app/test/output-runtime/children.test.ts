import {expect,it} from 'vitest';
import {fixture,held} from './fixture.js';
it('fences both owned children and drains each before native namespace close',async()=>{
 const f=fixture();const first=held();const second=held();let closed=0;
 f.scheduler.own({close:()=>{closed++;return first.settled.promise;}});f.scheduler.own({close:()=>{closed++;return second.settled.promise;}});
 const closing=f.scheduler.close();expect(closed).toBe(2);
 first.settled.resolve();await new Promise<void>(resolve=>setImmediate(resolve));expect(f.files.close).not.toHaveBeenCalled();
 second.settled.resolve();await closing;expect(f.files.close).toHaveBeenCalledTimes(1);f.dispose();
});
