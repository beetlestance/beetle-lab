import type { DatabaseSync } from 'node:sqlite';
import { encodeJson } from '@beetle/contracts';
import { captureSettlementRequest } from '@beetle/contracts/output-settlement';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import { commitAgentSettlement } from '../settlement-guard/index.js';
import { readRetiredReply } from './rows.js';
import { Failure,transaction } from '../sql.js';
import { settlementOperation } from '../settlement-protocol.js';
import type { SettlementOperation,SettlementValue } from '../settlement-protocol.js';
function capture(input:SettlementOperation&{id:number}):SettlementOperation{
 const value=JSON.parse(encodeJson(input,4096)) as SettlementOperation&{id:number};
 if(!settlementOperation(value)||Object.keys(value).sort().join(',')!=='id,json,kind'
  ||!Number.isSafeInteger(value.id)||value.id<=0||typeof value.json!=='string'||Buffer.byteLength(value.json)>3584)throw new Failure('invalid_input');
 return{kind:value.kind,json:value.json};
}
export class SettlementStore{
 constructor(private readonly db:DatabaseSync){}
 execute(input:SettlementOperation&{id:number}):SettlementValue{
  const operation=capture(input);let value:unknown;
  try{value=JSON.parse(operation.json) as unknown;}catch{throw new Failure('invalid_input');}
  return transaction(this.db,()=>operation.kind==='settleAgentStorage'
   ?commitAgentSettlement(this.db,captureSettlementRequest(value))
   :{reply:readRetiredReply(this.db,captureOutputRetirementRequest(value))});
 }
}
