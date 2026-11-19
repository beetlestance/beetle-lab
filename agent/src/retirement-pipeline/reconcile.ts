import type { ReconcileOutcome } from '../task-inventory/index.js';
import { RetirementPipelineError } from './types.js';
import { check, metadata, retireProducer } from './execute.js';
import type { PipelineExecution } from './execute.js';
/**
 * Producer then runtime retirement replayed from the stored request prove the original runtime is
 * gone before anything is observed. An attempt that already settled, has no prepared task, or has
 * a cleanup plan is refused: reconciliation never adds authority to facts observed earlier.
 */
export async function executeReconciliation(context: PipelineExecution): Promise<ReconcileOutcome> {
  const { options, request, operation, entry, ports } = context;
  const { organizationId, workspaceId, attemptId, generation } = request;
  const key = { organizationId, workspaceId, attemptId, generation };
  const replay = await metadata(context, () => options.journal.settlements.retiredReply(request));
  check(context);
  if (replay) throw new RetirementPipelineError('conflict');
  const producer = await retireProducer(context);
  check(context);
  const selected = await metadata(context, () => options.journal.retirements.read(key));
  check(context);
  if (selected?.task.state !== 'prepared') throw new RetirementPipelineError('conflict');
  const runtime = await options.runtime.retire(producer, operation);
  check(context);
  if (await metadata(context, () => options.journal.cleanupPlans.read(key)))
    throw new RetirementPipelineError('conflict');
  check(context);
  const native = ports
    ? options.inventory.reconcileWithPorts(runtime, operation, ports.inventory)
    : options.inventory.reconcile(runtime, operation);
  entry.native = native;
  const result = await native.result;
  await native.quiesced;
  try {
    await native.close();
  } catch (error) {
    entry.uncertain = true;
    throw error;
  }
  check(context);
  if (!result.ok) throw new RetirementPipelineError('unavailable');
  const outcome = result.outcome;
  if (outcome.state === 'current') return outcome;
  const stored = await metadata(context, () =>
    options.journal.stagingNamespace.reconcileTask(key, outcome.reconciliation),
  );
  check(context);
  return { state: 'reconciled', reconciliation: stored };
}
