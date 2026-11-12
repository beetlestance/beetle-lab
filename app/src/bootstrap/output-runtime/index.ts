import {captureExports} from './exports.js';
import {captureDeletions} from './deletions.js';
import {startOutputDeletionRuntime} from '../../application/output-deletion-runtime/index.js';
import {createHash} from 'node:crypto';
import {startExportRuntime} from '../../application/export-runtime/index.js';
import {transferMetadata} from './metadata.js';
import { OutputByteError } from '../../ports/output-bytes.js';
import { randomUUID } from 'node:crypto';
import { openLocalOutputBytes } from '../../adapters/outbound/files/outputs/index.js';
import { createOutputTransfers } from '../../application/output-transfer/index.js';
import type { RunnerAttemptIdentity } from '../../ports/runner.js';
import type { OutputRuntime, OutputRuntimeOptions } from '../../ports/output-runtime.js';
import { OutputScheduler } from './scheduler.js';
import { outputRoots } from './roots.js';
import { requireValue } from './validation.js';

function capabilities({absences, observations, gateway}: OutputRuntimeOptions): void {
  requireValue(typeof absences?.read === 'function' && typeof absences.adopt === 'function'
    && typeof absences.finalize === 'function' && typeof observations?.observe === 'function'
    && typeof gateway?.output === 'function' && typeof gateway.attempt === 'function');
}
/** Capture installation inputs and bind externally owned methods before native awaits. */
function capture(options: OutputRuntimeOptions): OutputRuntimeOptions {
  const {dataRoot, outputs, finalizations, absences, observations, runs, gateway, freeSpaceReserveBytes, onFailure} = options;
  const intervalMs = options.intervalMs ?? 250;
  requireValue(typeof dataRoot === 'string' && typeof onFailure === 'function');
  requireValue(Number.isSafeInteger(freeSpaceReserveBytes) && freeSpaceReserveBytes >= 0);
  requireValue(Number.isSafeInteger(intervalMs) && intervalMs >= 25 && intervalMs <= 60000);
  capabilities(options);
  const attempt = gateway.attempt.bind(gateway);
  return Object.freeze({dataRoot, freeSpaceReserveBytes, intervalMs, onFailure,
    ...captureExports(options),...captureDeletions(options),
    outputs: Object.freeze({scan: outputs.scan.bind(outputs), load: outputs.load.bind(outputs), readSource: outputs.readSource.bind(outputs),
      adopt: outputs.adopt.bind(outputs), claimArtifact: outputs.claimArtifact.bind(outputs), recordProgress: outputs.recordProgress.bind(outputs),
      beginPublication: outputs.beginPublication.bind(outputs), recordPublication: outputs.recordPublication.bind(outputs)}),
    finalizations: Object.freeze({finalize: finalizations.finalize.bind(finalizations)}),
    absences: Object.freeze({read: absences.read.bind(absences), adopt: absences.adopt.bind(absences), finalize: absences.finalize.bind(absences)}),
    observations: Object.freeze({observe: observations.observe.bind(observations)}),
    runs: Object.freeze({getRun: runs.getRun.bind(runs)}), gateway: Object.freeze({output: gateway.output.bind(gateway), attempt: (identity: RunnerAttemptIdentity) => {
      const client = attempt(identity); requireValue(typeof client?.snapshot === 'function');
      return Object.freeze({snapshot: client.snapshot.bind(client)});
    }})});
}
/** Installation-owned output namespace and bounded automatic publication loop.
 * Metadata, Run readers and the shared runner gateway remain externally owned. */
export async function openOutputRuntime(options: OutputRuntimeOptions): Promise<OutputRuntime> {
  const captured = capture(options);
  const files = await openLocalOutputBytes(await outputRoots(captured.dataRoot));
  let scheduler:OutputScheduler|undefined;
  try {
    const transfers = createOutputTransfers({metadata: transferMetadata(captured), gateway: captured.gateway, files,
      freeSpaceReserveBytes: captured.freeSpaceReserveBytes, newWriterId: randomUUID,
      digest:value=>createHash('sha256').update(value).digest('hex')});
    const owner = new OutputScheduler(captured, transfers, files);scheduler=owner;
    if(captured.exports)owner.own(startExportRuntime({...captured.exports,transfers,intervalMs:captured.intervalMs??250,
      onFailure:async error=>{owner.failedChild(error);}}));
    if(captured.deletions)owner.own(startOutputDeletionRuntime({metadata:captured.deletions,files,freeSpaceReserveBytes:captured.freeSpaceReserveBytes,
      intervalMs:captured.intervalMs??250,onFailure:async error=>{owner.failedChild(error);}}));
    const read = files.read.bind(files);
    const publishedBytes = Object.freeze({read: (...args: Parameters<typeof read>) => {
      if (owner.state().status !== 'running') throw new OutputByteError('closed');
      return read(...args);
    }});
    owner.start();
    return Object.freeze({publishedBytes, state: () => owner.state(), close: () => owner.close()});
  } catch (error) {
    try { if(scheduler)await scheduler.close();else await files.close(); }
    catch (cleanup) { throw new AggregateError([error, cleanup], 'Output startup cleanup failed', {cause: cleanup}); }
    throw error;
  }
}
