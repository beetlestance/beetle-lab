import { captureK6Warnings } from '@beetle/contracts/k6-warnings';
import type { K6WarningArtifact } from '@beetle/contracts/k6-warnings';
import { distributionPercentile } from '@beetle/contracts/metrics';
import { configuredArrivalGuidance } from '../../compiler/index.js';
import type { CompiledInput } from '../input/index.js';
import type { SeriesTotal } from '@beetle/contracts/metrics';
import type { ExecutionReceipt } from '../execution/index.js';
function completeMetrics(receipt: ExecutionReceipt): boolean {
  return receipt.ok && receipt.process?.collection === 'complete' && receipt.process.cause === null && receipt.metrics?.totalsComplete === true;
}
function median(receipt: ExecutionReceipt): K6WarningArtifact['iteration'] {
  if (!completeMetrics(receipt)) return null;
  const rows = receipt.metrics!.totals.filter(globalIteration);
  return rows.length === 1 ? seriesMedian(rows[0]!) : null;
}
function seriesMedian(row: SeriesTotal): K6WarningArtifact['iteration'] {
  if (row.kind !== 'trend' || row.total.kind !== 'trend') return null;
  const total = row.total; const p = distributionPercentile(total.distribution, 50);
  if (!p || p.estimate <= 0 || total.count !== total.distribution.count) return null;
  return {estimate: p.estimate, lower: p.lower, upper: p.upper, count: total.count};
}
/** Only closed native evidence is publishable. Older/fake receipts stay absent. */
export function warningArtifact(compiled: CompiledInput, receipt: ExecutionReceipt, scope: Pick<K6WarningArtifact['scope'], 'organizationId' | 'workspaceId' | 'attemptId'>): K6WarningArtifact | null {
  const process = receipt.process;
  if (!process?.spawned || !process.stdioClosed || !process.warnings) return null;
  const native = {...process.warnings, coverage: process.cause === null && process.collection === 'complete' ? process.warnings.coverage : 'partial'};
  const {organizationId, workspaceId, attemptId} = scope;
  return captureK6Warnings({format: 'beetle-k6-warnings', version: 1,
    scope: {organizationId, workspaceId, attemptId, generation: 1}, native,
    configuration: configuredArrivalGuidance(compiled.suite.loadPlan), iteration: median(receipt)});
}

function globalIteration(row: SeriesTotal): boolean {
  return row.metric === 'iteration_duration' && row.scope === 'execute'
    && Object.keys(row.tags).length === 1 && row.tags.phase === 'execute';
}
