import { expect,it } from 'vitest';
import { mkdir } from 'node:fs/promises';
import { fixture } from './fixtures.js';
import { loseReply } from '../source-journal/fixtures.js';
import { captureStoredCleanupReceipt } from '../../src/cleanup-control/index.js';
const f=fixture();const operation=()=>({deadline:performance.now()+10000});
it('commits genuine post-close whole-task absence and revalidates native state for exact receipt replay',async()=>{
 const e=await f.completed();expect(await e.owner.cleanupReceipts.read(e.plan)).toBeNull();const count=e.effects.length;
 const stored=await e.receipt.finalizeWithPorts(e.token,operation(),e.ports);expect(stored.receipt).toMatchObject({closure:'owned-task-absent-after-original-close-v1',finalProgressVersion:e.plan.entries.length+2});
 expect(await e.receipt.finalizeWithPorts(e.token,operation(),e.ports)).toEqual(stored);expect(e.effects).toHaveLength(count);expect(await e.owner.cleanupReceipts.read(e.plan)).toEqual(stored);
 await mkdir(e.task,{mode:0o700});await expect(e.receipt.finalizeWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(await e.owner.cleanupReceipts.read(e.plan)).toEqual(stored);
});
it('recovers a committed immutable receipt after lost reply and actual worker termination/reopen',async()=>{
 const e=await f.completed();const proof=await e.removal.stepWithProofAndPorts(e.token,operation(),e.ports);expect(proof.absence).toBeTruthy();
 const committed=await e.receipt.finalizeWithPorts(e.token,operation(),e.ports);
 const raw=await loseReply(e.owner,()=>e.owner.cleanupReceipts.commit(e.plan,committed.receipt));await e.owner.cleanupReceipts.settleCarrier();
 if(!raw||typeof raw!=='object'||!('stored' in raw))throw Error('Missing actual receipt reply');expect(captureStoredCleanupReceipt(raw.stored,e.plan)).toEqual(committed);
 const journal=await f.open(e.journalPath);expect(await journal.cleanupReceipts.read(e.plan)).toEqual(committed);expect(await journal.cleanupReceipts.commit(e.plan,committed.receipt)).toEqual(committed);await journal.close();
});
it('refuses revoked native proof owners and does not manufacture receipt from final progress',async()=>{
 const e=await f.completed();const raw=await e.removal.stepWithProofAndPorts(e.token,operation(),e.ports);expect(raw.absence).toBeTruthy();await e.removal.close();
 await expect(e.receipt.finalizeWithPorts(e.token,operation(),e.ports)).rejects.toBeTruthy();expect(await e.owner.cleanupReceipts.read(e.plan)).toBeNull();
});
