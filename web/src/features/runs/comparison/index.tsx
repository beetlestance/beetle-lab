import { useId, useMemo } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { validateApi } from '@beetle/contracts/api';
import type { RunComparisonItem, RunComparisonMetricRead, RunMetricKey, RunMetricSeriesPage } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import type { RunScope } from '../types.js';
import { SamplesView, evidence, valueNumber } from '../metrics/index.js';
import type { ReadAdmission } from '../metrics/index.js';
import { comparisonRunIds } from './selection.js';
import { useComparison } from './useComparison.js';
import { ComparisonFacts } from './Facts.js';
export function RunComparison(scope: RunScope) {
  const {search} = useLocation(); const ids = comparisonRunIds(search);
  if (!ids) return <section><h1>Invalid comparison</h1><p>Select two to four distinct runs in workspace history.</p></section>;
  return <Comparison scope={scope} ids={ids} />;
}
function Comparison({scope, ids}: {scope: RunScope; ids: string[]}) {
  const state = useComparison(scope, ids); const snapshot = state.view.snapshot;
  return <section><header className="section-header"><h1>Compare runs</h1><button disabled={state.busy} onClick={state.retry}>Refresh comparison</button></header>
    <Link to={routes.runs(scope.organizationId, scope.workspaceId)}>Back to run history</Link>
    <p>The first selected run is the baseline. Differences describe recorded evidence, not a statistical comparability verdict.</p>
    {state.view.busy && <p role="status">Loading comparison…</p>}
    {state.view.error && <p role="alert">Comparison could not be loaded. Use Refresh comparison to retry.</p>}
    {snapshot && <>
      {state.view.page ? <MetricSelection page={state.view.page} busy={state.busy} select={state.select} next={state.page} />
        : <button disabled={state.busy} onClick={() => state.page()}>Choose another metric</button>}
      {snapshot.metricBinding && <p>Logical request: {snapshot.metricBinding.requestId ?? 'aggregate'}; assertion: {snapshot.metricBinding.assertionId ?? 'none'}.</p>}
      <p>Charts use each run’s own UTC source time and independent vertical scale; timelines are not aligned.</p>
      {snapshot.items.map((item, index) => <article key={item.run.id}><h2>{index === 0 ? 'Baseline' : `Run ${index + 1}`}: <Link to={routes.run(scope.organizationId, scope.workspaceId, item.run.id)}>{item.run.id}</Link></h2>
        <ComparisonFacts item={item} /><ComparedMetric item={item} admission={state.admission} /></article>)}
    </>}
  </section>;
}
function MetricSelection({page, busy, select, next}: {page: RunMetricSeriesPage; busy: boolean; select: (metric: RunMetricKey) => void; next: (cursor?: string) => void}) {
  const id = useId();
  return <section><label htmlFor={id}>Baseline metric</label><select id={id} value="" disabled={busy || page.availability !== 'ready'} onChange={event => {
    const series = page.items.find(item => String(item.ordinal) === event.target.value);
    if (!series) return;
    const checked = validateApi('RunMetricKey', {metric: series.metric, kind: series.kind, scope: series.scope, tags: series.tags});
    if (checked.ok) select(checked.value);
  }}><option value="">Choose a recorded series</option>{page.items.filter(series => series.tags.phase !== 'prepare').map(series => <option key={series.ordinal} value={series.ordinal}>
    {series.metric} · {series.scope} · {series.tags.request ?? 'aggregate'} {series.tags.assertion ?? ''}</option>)}</select>
    {page.availability !== 'ready' && <p role="status">Baseline metric catalogue: {page.availability}{page.reason ? ` (${page.reason})` : ''}. Refresh manually to check again.</p>}
    {page.availability === 'ready' && page.items.length === 0 && <p>No recorded series.</p>}
    {page.nextCursor && <button disabled={busy} onClick={() => next(page.nextCursor ?? undefined)}>Next metric page</button>}
  </section>;
}
function ComparedMetric({item, admission}: {item: RunComparisonItem; admission: ReadAdmission}) {
  const read = item.metric; const series = read.series;
  const source = useMemo(() => ({id: item.run.id, scope: item.run.scope, attemptId: item.run.activeAttemptId, manifestDigest: read.manifestDigest}), [item]);
  if (read.availability !== 'ready' || !series || read.manifestDigest === null) return <p>Metric: {read.availability}{read.reason ? ` (${read.reason})` : ''}.</p>;
  return <section><h3>{series.metric} · {series.scope}</h3><p>Actual series {series.ordinal}; request {series.tags.request ?? 'aggregate'}; assertion {series.tags.assertion ?? 'none'}.</p>
    <p>Whole-run total: {valueNumber(series.total) ?? 'No samples'} {series.unit}. {evidence(series.total)}.</p>
    <MetricSource read={read} />
    <SamplesView page={source} series={series} admission={admission} range={undefined} />
  </section>;
}

function MetricSource({read}: {read: RunComparisonMetricRead}) {
  return <><p>Source manifest: <code>{read.manifestDigest}</code></p>
    <p>Source marker: {read.measurementSourceTimeMs} ms; coverage {read.coverage?.complete ? 'complete' : 'partial'}; late points {read.coverage?.latePoints}; delayed buckets omitted {read.coverage?.markerDelayDroppedBuckets}.</p></>;
}
