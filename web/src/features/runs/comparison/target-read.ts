import type { Artifact } from '@beetle/contracts';
import type { ApiClient, RunComparisonItem, RunResultSnapshot, Run } from '@beetle/contracts/api';
import type { TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import { readResult } from '../../../app/api.js';
import { resultView } from '../../run-results/index.js';
import { targetReportReads } from '../target-observations/read.js';
import type { TargetReportReads } from '../target-observations/read.js';
export type ComparisonTargetRead =
  | { readonly status: 'disabled' | 'unavailable' | 'error' }
  | { readonly status: 'ready'; readonly report: TargetRuntimeReport; readonly numeric: Artifact | null };
export type ComparisonTargets = ReadonlyMap<string, ComparisonTargetRead>;
interface Context {
  api: ApiClient;
  signal: AbortSignal;
  alive(): boolean;
}
/** Sequential under comparison admission; byte originals retain the shared artifact credit. */
export async function readComparisonTarget(
  context: Context,
  item: RunComparisonItem,
  reads: Pick<TargetReportReads, 'read'> = targetReportReads,
): Promise<ComparisonTargetRead> {
  if (item.environment.targetSampler === 'disabled') return { status: 'disabled' };
  const { run } = item;
  const { organizationId, workspaceId } = run.scope;
  try {
    if (!context.alive()) return { status: 'unavailable' };
    const snapshot = await readResult(
      context.api.getRunResult({ params: { organizationId, workspaceId, runId: run.id }, signal: context.signal }),
    );
    const selected = targetSelection(snapshot, run);
    if (!context.alive() || !selected) return { status: 'unavailable' };
    const { artifact, numeric } = selected;
    const report = await reads.read({
      params: {
        organizationId,
        workspaceId,
        runId: run.id,
        attemptId: run.activeAttemptId,
        artifactId: artifact.artifactId,
      },
      artifact,
      signal: context.signal,
    });
    return context.alive() ? { status: 'ready', report, numeric } : { status: 'unavailable' };
  } catch {
    return { status: 'error' };
  }
}

function targetSelection(snapshot: RunResultSnapshot, run: Run) {
  if (snapshot.id !== run.id || snapshot.activeAttemptId !== run.activeAttemptId) return null;
  const view = resultView({ scope: run.scope, runId: run.id, run, result: snapshot.result, status: 'ready' });
  if (view.status !== 'ready') return null;
  const targets = view.result.artifacts.filter((a) => a.kind === 'target-runtime');
  if (targets.length !== 1) return null;
  const numeric = view.result.artifacts.filter((a) => a.kind === 'numeric-final');
  return { artifact: targets[0]!, numeric: numeric.length === 1 ? numeric[0]! : null };
}
