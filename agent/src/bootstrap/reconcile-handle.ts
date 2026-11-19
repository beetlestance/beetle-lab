import type { Journal } from '../journal/index.js';
import type { Operation } from '../backends/docker/index.js';
import { RetirementPipelineError, type RetirementPipeline } from '../retirement-pipeline/index.js';
import type { ReconcileKey, ReconcileRuntime } from './types.js';
/**
 * The request replayed is the one stored with the retirement intent; the operator supplies only
 * the attempt key. A key without a stored intent is refused before any retirement work starts.
 */
export function reconcileHandle(
  journal: Journal,
  cleanup: Pick<RetirementPipeline, 'reconcileWithPorts'>,
  close: () => Promise<void>,
): ReconcileRuntime {
  return Object.freeze({
    candidates: (after: string | null) => journal.stagingNamespace.reconciliationCandidates(after),
    async reconcile(key: ReconcileKey, operation: Operation) {
      const intent = await journal.retirements.read(key);
      if (!intent) throw new RetirementPipelineError('conflict');
      // The pipeline settles retained originals before `settled`; close waits for it as well.
      const work = cleanup.reconcileWithPorts(intent.request, operation);
      try {
        return await work.result;
      } finally {
        await work.settled;
      }
    },
    close,
  });
}
