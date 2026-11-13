import type { RetirementReply } from '@beetle/contracts/output-retirement';
import type { SettlementReply } from '@beetle/contracts/output-settlement';
export type SettlementOperation={readonly kind:'settleAgentStorage'|'readRetiredOutputReply';readonly json:string};
export type SettlementValue=SettlementReply|{readonly reply:RetirementReply|null};
export function settlementOperation(input:{kind:string}):input is SettlementOperation{
 return input.kind==='settleAgentStorage'||input.kind==='readRetiredOutputReply';
}
