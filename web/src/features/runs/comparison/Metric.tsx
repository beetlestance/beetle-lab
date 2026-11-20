import { availabilityWithReason } from './availability.js';
import { useId, useMemo } from 'react';
import { validateApi } from '@beetle/contracts/api';
import type {
  RunComparisonItem,
  RunComparisonMetricRead,
  RunMetricKey,
  RunMetricSeriesPage,
} from '@beetle/contracts/api';
import { SamplesView, evidence, valueNumber } from '../metrics/index.js';
import type { ReadAdmission } from '../metrics/index.js';

export function MetricSelection({
  page,
  busy,
  select,
  next,
}: {
  page: RunMetricSeriesPage;
  busy: boolean;
  select: (metric: RunMetricKey) => void;
  next: (cursor?: string) => void;
}) {
  const id = useId();
  return (
    <section>
      <label htmlFor={id}>Baseline metric</label>
      <select
        id={id}
        value=""
        disabled={busy || page.availability !== 'ready'}
        onChange={(event) => {
          const series = page.items.find((item) => String(item.ordinal) === event.target.value);
          if (!series) return;
          const checked = validateApi('RunMetricKey', {
            metric: series.metric,
            kind: series.kind,
            scope: series.scope,
            tags: series.tags,
          });
          if (checked.ok) select(checked.value);
        }}
      >
        <option value="">Choose a recorded series</option>
        {page.items
          .filter((series) => series.tags.phase !== 'prepare')
          .map((series) => (
            <option key={series.ordinal} value={series.ordinal}>
              {series.metric} · {series.scope} · {series.tags.request ?? 'aggregate'} {series.tags.assertion ?? ''}
            </option>
          ))}
      </select>
      {page.availability !== 'ready' && (
        <p role="status">
          Baseline metric catalogue: {availabilityWithReason(page.availability, page.reason)}. Refresh manually to
          check again.
        </p>
      )}
      {page.availability === 'ready' && page.items.length === 0 && <p>No recorded series.</p>}
      {page.nextCursor && (
        <button disabled={busy} onClick={() => next(page.nextCursor ?? undefined)}>
          Next metric page
        </button>
      )}
    </section>
  );
}
export function ComparedMetric({ item, admission }: { item: RunComparisonItem; admission: ReadAdmission }) {
  const read = item.metric;
  const series = read.series;
  const source = useMemo(
    () => ({
      id: item.run.id,
      scope: item.run.scope,
      attemptId: item.run.activeAttemptId,
      manifestDigest: read.manifestDigest,
    }),
    [item],
  );
  if (read.availability === 'not_requested') return <p>Choose a recorded series to compare it across runs.</p>;
  if (read.availability !== 'ready' || !series || read.manifestDigest === null)
    return <p>Metric: {availabilityWithReason(read.availability, read.reason)}.</p>;
  return (
    <section>
      <h3>
        {series.metric} · {series.scope}
      </h3>
      <p>
        Actual series {series.ordinal}; request {series.tags.request ?? 'aggregate'}; assertion{' '}
        {series.tags.assertion ?? 'none'}.
      </p>
      <p>
        Whole-run total: {valueNumber(series.total) ?? 'No samples'} {series.unit}. {evidence(series.total)}.
      </p>
      <MetricSource read={read} />
      <SamplesView page={source} series={series} admission={admission} range={undefined} />
    </section>
  );
}

function MetricSource({ read }: { read: RunComparisonMetricRead }) {
  return (
    <>
      <p>
        Source manifest: <code>{read.manifestDigest}</code>
      </p>
      <p>
        Source marker: {read.measurementSourceTimeMs} ms; coverage {read.coverage?.complete ? 'complete' : 'partial'};
        late points {read.coverage?.latePoints}; delayed buckets omitted {read.coverage?.markerDelayDroppedBuckets}.
      </p>
    </>
  );
}
