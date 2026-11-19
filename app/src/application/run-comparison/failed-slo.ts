import type { RunComparisonFailedSlo, RunComparisonSloLimit, RunComparisonSlo } from '@beetle/contracts/api';
import type { Source } from './source.js';
/** Source capture verifies the seal and immutable revision pins before this projection. */
export function comparisonSlos(source: Source): RunComparisonSlo[] {
  return (
    source.result?.thresholds.filter((rule) => rule.purpose === 'slo').map((rule) => projectSlo(source, rule)) ?? []
  );
}
export function firstFailedSlo(slos: readonly RunComparisonSlo[]): RunComparisonFailedSlo | null {
  const first = slos.find((rule) => !rule.passed);
  if (!first) return null;
  return { id: first.id, reading: first.reading, limit: first.limit };
}
function projectSlo(source: Source, threshold: NonNullable<Source['result']>['thresholds'][number]): RunComparisonSlo {
  const reading = threshold.reading ?? null;
  const matches = source.config.loadPlan.slos.filter((rule) => rule.id === threshold.id);
  const rule = matches.length === 1 ? matches[0] : undefined;
  const limit: RunComparisonSloLimit | null =
    rule && (!reading || (reading.metric === rule.metric && reading.stat === rule.stat))
      ? { metric: rule.metric, stat: rule.stat, operator: rule.operator, value: rule.value }
      : null;
  return { id: threshold.id, passed: threshold.passed, reading, limit };
}
