import { expect,it } from 'vitest';
import { fixture } from './fixtures.js';
const f=fixture();
it('captures immutable observed bytes independently of mutable returned plan objects',async()=>{
 const e=await f.prepared();const expected=structuredClone(e.plan);
 Reflect.set(e.plan.entries[0]!.native,'ino','0');Reflect.set(e.plan,'retirementRequestDigest','f'.repeat(64));
 const stored=await e.inventory.persist(e.observed,{deadline:performance.now()+10000});expect(stored.plan).toEqual(expected);
 expect(await e.owner.cleanupPlans.read(e.key)).toEqual(stored);
});
it('binds observations to exact physical Journal ports and refuses expired calls before command dispatch',async()=>{
 const e=await f.prepared();const other=await f.prepared();
 await expect(other.inventory.persist(e.observed,{deadline:performance.now()+10000})).rejects.toMatchObject({reason:'custody'});
 const before=Reflect.get(e.owner,'nextId');await expect(e.inventory.persist(e.observed,{deadline:performance.now()-1})).rejects.toMatchObject({reason:'deadline'});
 expect(Reflect.get(e.owner,'nextId')).toBe(before);expect(await other.owner.cleanupPlans.read(other.key)).toBeNull();expect(await e.owner.cleanupPlans.read(e.key)).toBeNull();
});
