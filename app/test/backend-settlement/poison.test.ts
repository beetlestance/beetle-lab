import { expect,it } from 'vitest';
import { fixture } from './fixture.js';
import { poisonSettlementConnection } from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
it('attempts uncertain native close only once and poisons all later Store commands',()=>{
 const f=fixture();const close=f.db.close.bind(f.db);let calls=0;
 f.db.close=()=>{calls++;throw Error('synthetic native close uncertainty');};
 try{
  expect(()=>poisonSettlementConnection(f.db)).toThrow('unavailable');expect(()=>poisonSettlementConnection(f.db)).toThrow('unavailable');
  expect(calls).toBe(1);expect(()=>f.store.execute({kind:'readBackendSettlement',key:f.key})).toThrow('unavailable');
 }finally{f.db.close=close;}
});
