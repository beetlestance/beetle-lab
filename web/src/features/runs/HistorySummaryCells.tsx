import type { RunHistorySummary } from '@beetle/contracts/api';
import { Td } from '../../components/Table.js';
import { formatDuration, formatNumber, formatPercent } from '../run-results/format.js';

const unknown = '—';
/** Why a summary has no numbers; null when it is ready with complete coverage. */
export function summaryStatus(value: RunHistorySummary): string | null {
  if (value.availability === 'ready') return value.source?.coverage.complete ? null : 'Partial window coverage';
  return {
    pending: 'Index pending',
    not_recorded: 'Not recorded',
    unsupported_format: 'Unsupported format',
    unavailable: 'Unavailable',
  }[value.availability];
}
function Unknown({ label }: { label: string }) {
  return <span aria-label={label}>{unknown}</span>;
}
/** Stored summary cells only: measured values, missing stays unknown, never zero. */
export function HistorySummaryCells({ value }: { value: RunHistorySummary }) {
  const p95 = value.httpP95;
  const state = summaryStatus(value);
  const length = formatDuration(value.testDurationMs);
  const rps = formatNumber(value.requestsPerSecond, 'integer');
  const failed = formatPercent(value.httpFailureRatio);
  return (
    <>
      <Td numeric title="k6-reported test duration">
        {length ?? <Unknown label="Length unknown" />}
        {state && <span className="history-cell-note">{state}</span>}
      </Td>
      <Td
        numeric
        title="Execute HTTP requests divided by the k6-reported test duration. This is an observed average, not the configured arrival rate."
      >
        {rps ?? <Unknown label="Request rate unknown" />}
      </Td>
      <Td
        numeric
        title={
          p95
            ? `Histogram estimate between ${formatNumber(p95.lower)} and ${formatNumber(p95.upper)} ms`
            : 'No recorded HTTP duration samples'
        }
      >
        {p95 ? `≈ ${formatNumber(p95.estimate, 'integer')} ms` : <Unknown label="p95 unknown" />}
      </Td>
      <Td
        numeric
        title={
          value.httpFailures !== null && value.httpSamples !== null
            ? `${formatNumber(value.httpFailures, 'integer')} of ${formatNumber(value.httpSamples, 'integer')} HTTP samples failed; assertion failures are separate`
            : 'HTTP failed samples, separately from assertion failures and overall test outcome'
        }
      >
        {failed ?? <Unknown label="Failed share unknown" />}
      </Td>
    </>
  );
}
