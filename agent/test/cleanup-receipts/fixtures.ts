import { afterEach } from 'vitest';
import { fixture as removalFixture } from '../native-removal/fixtures.js';
import { NativeReceipt } from '../../src/native-receipt/index.js';
export function fixture(){const f=removalFixture();const receipts:NativeReceipt[]=[];afterEach(async()=>{await Promise.allSettled(receipts.splice(0).map(owner=>owner.close()));});
 return{...f,async completed(){const e=await f.ready();for(let n=0;n<e.plan.entries.length;n++)await e.removal.stepWithPorts(e.token,{deadline:performance.now()+10000},e.ports);
  const receipt=new NativeReceipt({journal:e.owner,root:e.staging.root,removal:e.removal});receipts.push(receipt);return{...e,receipt};
 }};
}
