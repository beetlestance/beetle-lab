import type { RunComparisonFailedSlo, RunComparisonSloLimit } from '@beetle/contracts/api';
import type { Source } from './source.js';
/** Source capture has verified result seal and immutable revision/config pins. */
export function firstFailedSlo(source: Source): RunComparisonFailedSlo | null {
  const failed = source.result?.thresholds.find((rule) => rule.purpose === 'slo' && !rule.passed);
  if (!failed) return null;
  const reading = failed.reading ?? null;
  const matches = source.config.loadPlan.slos.filter((rule) => rule.id === failed.id);
  const rule = matches.length === 1 ? matches[0] : undefined;
  const limit: RunComparisonSloLimit | null =
    rule && (!reading || (reading.metric === rule.metric && reading.stat === rule.stat))
      ? { metric: rule.metric, stat: rule.stat, operator: rule.operator, value: rule.value }
      : null;
  return { id: failed.id, reading, limit };
}
