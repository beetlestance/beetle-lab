import { useId, useState } from 'react';
import type { Artifact } from '@beetle/contracts';
import type { RunArtifactParams } from '@beetle/contracts/api';
import { targetMetricNames } from '@beetle/contracts/target-runtime';
import type { TargetMetricName, TargetRuntimeReport } from '@beetle/contracts/target-runtime';
import { useTargetReport } from './useReport.js';
import type { TargetReportReads } from './read.js';
import { TargetPointComparison } from './comparison.js';
import { observationSummary } from './summary.js';
import { TargetObservationChart } from './chart/index.js';
import './target.css';
export function RunTargetObservations({params, artifact, reads}: {
  params: RunArtifactParams; artifact: Artifact; reads?: Pick<TargetReportReads, 'read'>;
}) {
  const heading = useId(); const {state, retry} = useTargetReport({params, artifact}, reads);
  return <section className="target-observations" aria-labelledby={heading}>
    <header className="section-header"><div><h2 id={heading}>Target-reported runtime</h2>
      <p>Point observations from the target endpoint, separate from engine resource measurements.</p></div>
      <button disabled={state.status === 'loading'} onClick={retry}>Reload target report</button></header>
    {state.status === 'loading' && <p role="status">Loading target observations…</p>}
    {state.status === 'error' && <p role="alert">Target observations could not be verified or loaded. Reload to retry.</p>}
    {state.status === 'ready' && <Report key={artifact.sha256} report={state.report} />}
  </section>;
}
function initialMetric(report: TargetRuntimeReport): TargetMetricName {
  return targetMetricNames.find(name => report.samples.some(sample => sample.status === 'ready' && sample.values[name] !== null)) ?? 'rss';
}
function Report({report}: {report: TargetRuntimeReport}) {
  const [metric, setMetric] = useState<TargetMetricName>(() => initialMetric(report));
  const id = useId(); const summary = observationSummary(report, metric);
  return <>
    <label htmlFor={id}>Target metric</label><select id={id} value={metric} onChange={event => {
      const next = targetMetricNames.find(name => name === event.target.value); if (next) setMetric(next);
    }}>{targetMetricNames.map(name => <option key={name} value={name}>{name}</option>)}</select>
    <p>{summary.known} of {report.samples.length} observations contain this metric. Recorded missed count: {report.missed}.</p>
    {report.limited && <p role="status">Collection reached its limit; later target activity may be absent.</p>}
    <TargetPointComparison summary={summary} />
    <TargetObservationChart samples={report.samples} metric={metric} />
    <details><summary>Target observations</summary><div className="metric-table" tabIndex={0} role="region" aria-label="Target observation samples">
      <table><thead><tr><th scope="col">Observed at (UTC)</th><th scope="col">Phase</th><th scope="col">Status</th><th scope="col">{metric}</th><th scope="col">Reason</th></tr></thead>
        <tbody>{report.samples.map((sample, index) => <tr key={index}><td><time dateTime={sample.observedAt}>{sample.observedAt}</time></td>
          <td>{sample.phase}</td><td>{sample.status}</td><td>{sample.values[metric] ?? 'Unavailable'}</td><td>{sample.reason ?? 'None reported'}</td></tr>)}</tbody></table>
    </div></details>
  </>;
}
