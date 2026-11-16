import type { RetirementReply } from '@beetle/contracts/output-retirement';
import type { SettlementReply } from '@beetle/contracts/output-settlement';
export type SettlementOperation={readonly kind:'settleAgentStorage'|'readRetiredOutputReply'|'preflightAgentStorage';readonly json:string};
export type SettlementValue=SettlementReply|{readonly version:1;readonly state:'eligible';readonly requestDigest:string}|{readonly reply:RetirementReply|null};
export function settlementOperation(input:{kind:string}):input is SettlementOperation{
 return input.kind==='settleAgentStorage'||input.kind==='readRetiredOutputReply'||input.kind==='preflightAgentStorage';
}
