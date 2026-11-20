import { EXPORT_CONTROL_BYTES, EXPORT_RESULT_BYTES } from '@beetle/contracts';
import type { CreateRunExportRequest, ExportJob, StandaloneExportOptions } from '@beetle/contracts/api';
import type { IntentDigest } from '../namespaces/index.js';
import { getRun } from '../runs/index.js';
import type { RunReader } from '../../ports/runs.js';
import type { ExportStore } from '../../ports/exports.js';
import { createExport } from './service.js';

/** The largest script a default run export allows; a smaller run output budget lowers it. */
export const RUN_EXPORT_SCRIPT_BYTES = 1048576;

export interface CreateRunExportOperation {
  readonly kind: 'createRunExport';
  readonly runId: string;
  readonly id: string;
  readonly attemptId: string;
  readonly requestedAt: string;
  readonly request: CreateRunExportRequest;
}

/**
 * Exports what a run executed: its saved revision, engine profile, budget and execution policy.
 * The run's values are immutable, so a replayed request ID rebuilds the same export intent.
 */
export async function createRunExport(input: {
  operation: CreateRunExportOperation;
  digest: IntentDigest;
  runs: Pick<RunReader, 'getRun'>;
  store: ExportStore;
}): Promise<ExportJob> {
  const { operation } = input;
  const run = await getRun({ scope: operation.request.scope, id: operation.runId }, input.runs);
  const options: StandaloneExportOptions = operation.request.options ?? {
    maximumBuildBytes: Math.min(
      RUN_EXPORT_SCRIPT_BYTES,
      run.budget.outputBytes - EXPORT_CONTROL_BYTES - EXPORT_RESULT_BYTES,
    ),
    scriptTimeoutMs: run.budget.timeoutMs,
  };
  return createExport(
    {
      kind: 'createExport',
      id: operation.id,
      attemptId: operation.attemptId,
      requestedAt: operation.requestedAt,
      request: {
        scope: run.scope,
        requestId: operation.request.requestId,
        revisionId: run.revisionId,
        engineProfile: run.engine.profileId,
        budget: run.budget,
        executionPolicy: run.executionPolicy,
        options,
      },
    },
    input.digest,
    input.store,
  );
}
