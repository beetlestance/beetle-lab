import { expect } from 'vitest';
import { fixture as inventoryFixture } from '../task-inventory/fixtures.js';
export function fixture(){const f=inventoryFixture();return{...f,async prepared(){
 const e=await f.inventory();const work=e.inventory.prepareWithPorts(e.token,{deadline:performance.now()+10000},e.ports);
 const result=await work.result;expect(result.ok).toBe(true);if(!result.ok)throw Error(result.reason);await work.quiesced;
 return{...e,observed:result.observation,plan:result.plan};
}};}
