import type { ClientResult } from '@beetle/contracts';
import type { RetirementRequest,RetirementReply } from '@beetle/contracts/output-retirement';
/** Private original-bound transport only; no ACK storage, retry or refund. */
export interface RunnerRetirementGateway {
 retireOutput(request:RetirementRequest,signal?:AbortSignal):Promise<ClientResult<RetirementReply>>;
}
