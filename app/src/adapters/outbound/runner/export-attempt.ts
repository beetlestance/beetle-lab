import {createRunnerClient} from '@beetle/contracts';
import type {RunnerAttemptIdentity} from '../../../ports/runner.js';
import type {RunnerExportAttemptClient} from '../../../ports/export-runner.js';
import {createTransport} from './transport.js';
import type {Connection} from './transport.js';
import {captureIdentity} from './identity.js';
export function createExportAttempt(connection:Connection,identity:RunnerAttemptIdentity):RunnerExportAttemptClient {
 const original=captureIdentity(identity);const client=createRunnerClient(createTransport(connection,original));
 return Object.freeze({offerExport:(body,signal)=>client.offerExport(original.attemptId,body,signal),
  cancelExportOriginal:(body,signal)=>client.cancelExportOriginal(original.attemptId,body,signal),
  snapshot:signal=>client.snapshot(original.attemptId,signal),events:(after,signal)=>client.events(original.attemptId,after,signal),
  ack:(body,signal)=>client.ack(original.attemptId,body,signal)} satisfies RunnerExportAttemptClient);
}
