import { afterEach } from 'vitest';
import { unlink,rmdir } from 'node:fs/promises';
import { fixture as planFixture } from '../cleanup-plans/fixtures.js';
import { NativeRemoval } from '../../src/native-removal/index.js';
export function fixture(){const f=planFixture();const owners:NativeRemoval[]=[];afterEach(async()=>{await Promise.allSettled(owners.map(owner=>owner.close()));});
 return{...f,async ready(){const e=await f.prepared();await e.inventory.persist(e.observed,{deadline:performance.now()+10000});
  const removal=new NativeRemoval({journal:e.owner,root:e.staging.root});owners.push(removal);const effects:string[]=[];
  const ports={...e.ports,unlink:async(path:string)=>{effects.push(path);await unlink(path);},rmdir:async(path:string)=>{effects.push(path);await rmdir(path);}};
  return{...e,removal,ports,effects};
 }};
}
