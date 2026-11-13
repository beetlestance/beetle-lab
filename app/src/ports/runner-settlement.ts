import type { ClientResult } from '@beetle/contracts';
import type { SettlementRequest,SettlementReply } from '@beetle/contracts/output-settlement';
/** Private original-bound release instruction; backend credit waits for an exact reply. */
export interface RunnerSettlementGateway {
 settleOutput(request:SettlementRequest,signal?:AbortSignal):Promise<ClientResult<SettlementReply>>;
}
