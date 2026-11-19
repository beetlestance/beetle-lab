import type { RunComparisonItem, RunComparisonFailedSlo } from '@beetle/contracts/api';
import { thresholdSentence, thresholdLimitText } from '../result/threshold-sentence.js';
import { ruleUnit, ruleValue } from '../live/rule-units.js';
import { comparisonRunLabels } from './run-labels.js';

export function ComparisonFailedSlos({ items }: { items: readonly RunComparisonItem[] }) {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  const failed = items.filter((item) => item.result && item.result.failedSloCount > 0);
  if (failed.length === 0) return null;
  return (
    <ul className="compare-native-failures" aria-label="Native failed SLOs">
      {failed.map((item) => {
        const result = item.result!;
        const detail = result.firstFailedSlo;
        const count = result.failedSloCount;
        return (
          <li key={item.run.id}>
            <strong>{labels.get(item.run.id.toLowerCase())}</strong>:{' '}
            {count > 1 && `First of ${count} native SLO comparisons that failed: `}
            {detail
              ? failureText(detail)
              : `${count} native SLO comparison${count === 1 ? '' : 's'} failed; detail unavailable.`}
            {result.completeness !== 'complete' && ' Readings are from partial native evidence.'}
          </li>
        );
      })}
    </ul>
  );
}
function failureText(detail: RunComparisonFailedSlo): string {
  const { reading, limit, id } = detail;
  if (reading && limit)
    return thresholdSentence({ thresholds: [{ id, purpose: 'slo', passed: false, reading }] }, [{ id, ...limit }])!;
  if (reading)
    return `Threshold ${id} failed: native ${ruleValue(ruleUnit(reading), reading.value)}; saved limit unavailable.`;
  if (limit) return `Threshold ${id} failed; native reading unavailable; ${thresholdLimitText(limit)}.`;
  return `Threshold ${id} failed; native reading and saved limit unavailable.`;
}
