import { useId } from 'react';
import { validateApi } from '@beetle/contracts/api';
import type { LiveMetricSnapshot, Run } from '@beetle/contracts/api';
import type { RunScope } from '../types.js';
import { evidence, valueNumber } from '../metrics/Chart.js';
import { useLiveMetrics } from './useLiveMetrics.js';
import type { LiveMetricReads } from './read.js';
import {DroppedLoad} from '../load-advice/index.js';
export function RunLiveMetrics({run, scope, runId, reads}: {
  run: Run; scope: RunScope; runId: string; reads?: Pick<LiveMetricReads, 'read'>;
}) {
  const heading = useId();
  const enabled = liveEnabled(run, scope, runId);
  const state = useLiveMetrics({organizationId: scope.organizationId, workspaceId: scope.workspaceId,
    runId, attemptId: run.activeAttemptId}, enabled, reads);
  return <section className="run-metrics" aria-labelledby={heading}><header className="section-header"><div>
    <h2 id={heading}>Live metrics</h2><p>Latest measured source window. Updates while this active attempt is visible.</p></div></header>
    {state.status === 'loading' && <p role="status">Waiting for live metrics…</p>}
    {state.status === 'paused' && <p role="status">Live metrics paused.</p>}
    {state.status === 'unavailable' && <p role="status">Live metrics unavailable. Waiting for the next update.</p>}
    {state.status === 'stale' && <p role="status">Live metrics expired. Waiting for a fresh source window.</p>}
    {state.status === 'ready' && <Latest frame={state.value.frame} k6={run.engine.id==='k6'} />}</section>;
}
function Latest({frame,k6}: {frame: LiveMetricSnapshot;k6:boolean}) {
  return <><p>Source window: <time>{new Date(frame.startTimeMs).toISOString()}</time> – <time>{new Date(frame.endTimeMs).toISOString()}</time>.
    {' '}Upstream coverage: {frame.upstreamCoverage}. {frame.coalescedWindows} coalesced windows; {frame.subset.excludedSeries} series excluded.</p>
    {k6&&<DroppedLoad rows={frame.series} coverage={frame.upstreamCoverage} scope="live window" />}
    <div className="metric-table" tabIndex={0} role="region" aria-label="Live metric values"><table><thead><tr>
      <th scope="col">Metric</th><th scope="col">Scope / labels</th><th scope="col">Window value</th><th scope="col">Evidence</th></tr></thead>
      <tbody>{frame.subset.selected.map(selected => {
        const series = frame.series.find(row => row.ordinal === selected.ordinal);
        return <tr key={selected.ordinal}><th scope="row">{selected.metric}</th>
          <td>{selected.scope}{selected.tags.request ? ` · ${selected.tags.request}` : ''}{selected.tags.assertion ? ` · ${selected.tags.assertion}` : ''}</td>
          <td>{series ? `${valueNumber(series.total) ?? 'No samples'} ${series.unit}` : 'No samples'}</td>
          <td>{series ? evidence(series.total) : 'No value in this source window'}</td></tr>;
      })}</tbody></table></div></>;
}

function liveEnabled(run: Run, scope: RunScope, id: string): boolean {
  return validateApi('Run', run).ok && run.id === id && run.scope.organizationId === scope.organizationId
    && run.scope.workspaceId === scope.workspaceId && run.state === 'active' && !run.cancellationRequested;
}
