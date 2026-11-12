import { ReadAdmission } from './admission.js';
import { useId, useMemo, useState, useEffect } from 'react';
import type { Run, RunMetricSeriesPage, RunMetricSeries } from '@beetle/contracts/api';
import { useCatalogue } from './useCatalogue.js';
import { useSamples } from './useSamples.js';
import { MetricChart, evidence, valueNumber } from './Chart.js';
import { SourceRangeControls } from './range.js';
import type { MetricSampleSource, SourceRange } from './useSamples.js';
import {RecordedLoadAdvice} from '../load-advice/index.js';
export function RunMetrics({run, terminal}: {run: Run; terminal: boolean}) {
  const admission = useMemo(() => new ReadAdmission(), []);
  return <Inventory key={`${run.scope.organizationId}/${run.scope.workspaceId}/${run.id}/${run.activeAttemptId}`} run={run} terminal={terminal} admission={admission} />;
}
function Inventory({run, terminal, admission}: {run: Run; terminal: boolean; admission: ReadAdmission}) {
  const heading = useId();
  const {query, readPage} = useCatalogue(run, terminal, admission); const [busy, setBusy] = useState(false);
  useEffect(() => {setBusy(admission.busy); return admission.subscribe(() => setBusy(admission.busy));}, [admission]);
  const page = query.data;
  return <section className="run-metrics" aria-labelledby={heading}><header className="section-header"><div>
    <h2 id={heading}>Recorded metrics</h2><p>Published execution measurements, by source time.</p></div>
    <button disabled={query.isFetching || busy} onClick={() => void readPage()}>Refresh metrics</button></header>
    {query.isPending && <p role="status">Loading metric catalogue…</p>}
    {query.isError && <p role="alert">Metrics could not be loaded. Use Refresh metrics to retry.</p>}
    {!query.isError && page && <Catalogue page={page} k6={run.engine.id==='k6'} admission={admission} busy={busy || query.isFetching} readPage={readPage} />}</section>;
}
function Catalogue({page,k6, admission, busy, readPage}: {page: RunMetricSeriesPage;k6:boolean; admission: ReadAdmission; busy: boolean; readPage: (cursor?: string) => Promise<void>}) {
  return <>
      {page.availability === 'pending' && <p role="status">Metric publication is pending.</p>}
      {page.availability === 'absent' && <p role="status">No metric source was published for this attempt.</p>}
      {page.availability === 'unavailable' && <p role="status">{page.reason === 'not_recorded' ? 'Metric history was not recorded.' : 'This metric history format is unsupported.'}</p>}
      {page.availability === 'ready' && <Selection key={`${page.manifestDigest}/${page.items[0]?.ordinal ?? 0}`} page={page} admission={admission} />}
      <LoadAdvice page={page} k6={k6} />
      {page.nextCursor && <button disabled={busy} onClick={() => void readPage(page.nextCursor ?? undefined)}>Next series page</button>}
    </>;
}
function LoadAdvice({page,k6}:{page:RunMetricSeriesPage;k6:boolean}){
  if(page.availability!=='ready'||!k6)return null;
  const coverage=page.coverage?(page.coverage.complete?'complete':'partial'):'unknown';
  return <RecordedLoadAdvice rows={page.items} coverage={coverage} />;
}
function Selection({page, admission}: {page: RunMetricSeriesPage; admission: ReadAdmission}) {
  const id = useId(); const [selected, setSelected] = useState(page.items[0]?.ordinal ?? 0);
  const series = page.items.find(s => s.ordinal === selected);
  if (!series) return <p role="status">No recorded series.</p>;
  return <><label htmlFor={id}>Metric series</label><select id={id} value={selected} onChange={e => setSelected(Number(e.target.value))}>
    {page.items.map(s => <option key={s.ordinal} value={s.ordinal}>{s.metric} · {s.scope}{s.tags.request ? ` · ${s.tags.request}` : ''}{s.tags.assertion ? ` · ${s.tags.assertion}` : ''}</option>)}</select>
    <p>{page.totalSeries} whole-run series; {page.windows} source windows. Coverage {page.coverage?.complete ? 'complete' : 'partial'};
      {' '}{page.coverage?.latePoints ?? 0} late points; {page.coverage?.markerDelayDroppedBuckets ?? 0} delayed buckets omitted.</p>
    <SeriesView key={`${page.manifestDigest}/${series.ordinal}`} page={page} series={series} admission={admission} /></>;
}
function SeriesView({page, series, admission}: {page: RunMetricSeriesPage; series: RunMetricSeries; admission: ReadAdmission}) {
  const [range, setRange] = useState<SourceRange>();
  return <><p><strong>Whole-run total:</strong> {valueNumber(series.total) ?? 'No samples'} {series.unit}. {evidence(series.total)}.
    {' '}Scope: {series.scope}. Source marker: {page.measurementSourceTimeMs} ms.</p>
    <SourceRangeControls applied={range} onApply={setRange} onReset={() => setRange(undefined)} />
    <SamplesView key={range ? `${range.fromTimeMs}/${range.toTimeMs}` : 'all'} page={page} series={series} admission={admission} range={range} />
  </>;
}
export function SamplesView({page, series, admission, range}: {page: MetricSampleSource; series: RunMetricSeries; admission: ReadAdmission; range: SourceRange | undefined}) {
  const {view, load} = useSamples(page, series, admission, range);
  return <><p>{chartLabel(series.kind)} Gaps are unmeasured.</p>
    {view.busy && <p role="status">Loading source windows…</p>}
    {view.error && <p role="alert">Source samples could not be loaded. Automatic reads stopped; use Latest samples to retry.</p>}
    {!view.busy && !view.error && <MetricChart items={view.items} series={series} />}
    {view.limited && <p role="status">View limit reached: at most 1,000 points and ten pages. Older source windows remain available.</p>}
    <div className="button-row"><button disabled={view.busy} onClick={() => void load()}>Latest samples</button>
      <button disabled={view.busy || !view.nextCursor} onClick={() => void load(view.nextCursor ?? undefined)}>Older samples</button></div></>;
}
function chartLabel(kind: RunMetricSeries['kind']): string {
  switch (kind) {
    case 'trend': return 'Chart shows estimated p95 per source window.';
    case 'rate': return 'Chart shows ratios of recorded samples.';
    case 'counter': return 'Chart shows source-second bucket counts.';
    case 'gauge': return 'Chart shows latest source values.';
  }
}

export { ReadAdmission } from './admission.js';
export type { MetricSampleSource } from './useSamples.js';
export { evidence, valueNumber } from './Chart.js';
