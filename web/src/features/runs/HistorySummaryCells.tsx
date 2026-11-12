import type { RunHistorySummary } from '@beetle/contracts/api';
const number = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const unknown = 'Unknown';
function numeric(value: number | null, suffix = ''): string { return value === null ? unknown : number.format(value) + suffix; }
function failure(value: RunHistorySummary): string {
  if (value.httpFailures === null || value.httpSamples === null) return unknown;
  return number.format(value.httpFailures) + ' / ' + number.format(value.httpSamples)
    + ' (' + (value.httpFailureRatio === null ? 'ratio unknown' : number.format(value.httpFailureRatio * 100) + '%') + ')';
}
function status(value: RunHistorySummary): string | null {
  if (value.availability === 'ready') return value.source?.coverage.complete ? null : 'Partial window coverage';
  return { pending: 'Index pending', not_recorded: 'Not recorded', unsupported_format: 'Unsupported format', unavailable: 'Unavailable' }[value.availability];
}
export function HistorySummaryCells({ value }: { value: RunHistorySummary }) {
  const p95 = value.httpP95; const state = status(value);
  return <>
    <td>{numeric(value.testDurationMs === null ? null : value.testDurationMs / 1000, ' s')}{state && <span className="display-path">{state}</span>}</td>
    <td>{numeric(value.requestCount)}</td>
    <td title="Execute HTTP requests divided by the k6-reported test duration. This is an observed average, not the configured arrival rate.">{numeric(value.requestsPerSecond, ' req/s')}</td>
    <td title={p95 ? 'Histogram estimate between ' + number.format(p95.lower) + ' and ' + number.format(p95.upper) + ' ms' : 'No recorded HTTP duration samples'}>{p95 ? '≈ ' + numeric(p95.estimate, ' ms') : unknown}</td>
    <td title="HTTP failed samples, separately from assertion failures and overall test outcome">{failure(value)}</td>
    <td title="Original verified published artifact bytes; not current filesystem allocation">{numeric(value.publishedArtifactBytes, ' B')}</td>
    <td title={'Current retained logical allowance, including ' + numeric(value.metadataAllowanceBytes, ' B') + ' metadata; not physical disk use'}>{numeric(value.retainedLogicalBytes, ' B')}</td>
  </>;
}
