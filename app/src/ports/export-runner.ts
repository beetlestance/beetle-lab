import type {ClientResult,AttemptSnapshot,StandaloneExportAssignment} from '@beetle/contracts';
import type {RunnerAttemptIdentity,RunnerAttemptClient} from './runner.js';
import type {RunnerOutputAbsenceGateway} from './output-absence.js';
export interface RunnerExportAttemptClient extends Pick<RunnerAttemptClient,'snapshot'|'events'|'ack'> {
 offerExport(body:StandaloneExportAssignment,signal?:AbortSignal):Promise<ClientResult<AttemptSnapshot>>;
 cancelExportOriginal(body:StandaloneExportAssignment,signal?:AbortSignal):Promise<ClientResult<AttemptSnapshot>>;
}
/** Same connection, authentication and original-call credits as performance work. */
export interface RunnerExportGateway extends RunnerOutputAbsenceGateway {
 exportAttempt(identity:RunnerAttemptIdentity):RunnerExportAttemptClient;
}
