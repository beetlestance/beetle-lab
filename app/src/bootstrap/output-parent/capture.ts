import type { Metadata } from '../../adapters/outbound/sqlite/index.js';
import type { OutputRuntimeOptions } from '../../ports/output-runtime.js';
import type { RunnerGateway } from '../../ports/runner.js';
import type { RunReader } from '../../ports/runs.js';

export type DeliveryMetadata = Pick<Metadata, 'dispatch' | 'events' | 'updateRuntime'> & {
  readonly runs: Pick<RunReader, 'getRun'>;
};

/** Snapshot foreign method capabilities before startup yields to another owner. */
export function captureDeliveryMetadata(metadata: DeliveryMetadata): DeliveryMetadata {
  const { dispatch, events, runs } = metadata;
  return Object.freeze({
    dispatch: Object.freeze({ scan: dispatch.scan.bind(dispatch), readOffer: dispatch.readOffer.bind(dispatch),
      claim: dispatch.claim.bind(dispatch), observe: dispatch.observe.bind(dispatch) }),
    events: Object.freeze({ scan: events.scan.bind(events), load: events.load.bind(events), ingest: events.ingest.bind(events),
      confirmAck: events.confirmAck.bind(events), recordProblem: events.recordProblem.bind(events) }),
    runs: Object.freeze({ getRun: runs.getRun.bind(runs) }), updateRuntime: metadata.updateRuntime.bind(metadata),
  });
}

export function captureOutputMetadata(metadata: Pick<Metadata, 'outputs' | 'finalizations' | 'runs'>):
Pick<OutputRuntimeOptions, 'outputs' | 'finalizations' | 'runs'> {
  const { outputs, finalizations, runs } = metadata;
  return Object.freeze({
    outputs: Object.freeze({ scan: outputs.scan.bind(outputs), load: outputs.load.bind(outputs),
      readSource: outputs.readSource.bind(outputs), adopt: outputs.adopt.bind(outputs),
      claimArtifact: outputs.claimArtifact.bind(outputs), recordProgress: outputs.recordProgress.bind(outputs),
      beginPublication: outputs.beginPublication.bind(outputs), recordPublication: outputs.recordPublication.bind(outputs) }),
    finalizations: Object.freeze({ finalize: finalizations.finalize.bind(finalizations) }),
    runs: Object.freeze({ getRun: runs.getRun.bind(runs) }),
  });
}

export function captureGateway(gateway: RunnerGateway): RunnerGateway {
  return Object.freeze({ capabilities: gateway.capabilities.bind(gateway),
    attempt: gateway.attempt.bind(gateway), close: gateway.close.bind(gateway) });
}
