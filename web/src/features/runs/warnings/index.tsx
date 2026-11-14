import { useId, useState } from 'react';
import type { Artifact } from '@beetle/contracts';
import type { RunArtifactParams } from '@beetle/contracts/api';
import type { K6WarningArtifact } from '@beetle/contracts/k6-warnings';
import { useApi } from '../../../app/api.js';
import { useArtifactReport } from '../../../lib/use-artifact-report.js';
import { planningWithMedian } from '../load-advice/model.js';
import { warningReads } from './read.js';
export function RunWarnings({params, artifact}: {params: RunArtifactParams; artifact: Artifact}) {
  const {state, retry} = useArtifactReport({params, artifact}, warningReads, useApi());
  return <section aria-label="Native warnings"><h2>Native k6 warnings</h2>
    {state.status === 'loading' && <p role="status">Loading warning evidence…</p>}
    {state.status === 'error' && <><p role="alert">Warning evidence could not be verified.</p><button onClick={retry}>Reload warnings</button></>}
    {state.status === 'ready' && <WarningSummary key={artifact.sha256} report={state.value} />}
  </section>;
}
export function WarningSummary({report}: {report: K6WarningArtifact}) {
  const {native} = report;
  return <><p>Diagnostic coverage: {native.coverage}. Counts represent observed log records, not unique incidents or dropped iterations.</p>
    <dl><dt>Insufficient VUs</dt><dd>{native.insufficientVus}</dd><dt>High cardinality</dt><dd>{native.highCardinality}</dd>
      <dt>Maximum duration</dt><dd>{native.maxDuration}</dd><dt>Other warnings</dt><dd>{native.otherWarnings}</dd>
      <dt>Discarded segments</dt><dd>{native.discardedSegments}</dd></dl>
    {native.coverage === 'partial' && <p>Missing or unclassified diagnostics may hide additional warnings.</p>}
    <ConfiguredGuidance report={report} /></>;
}
function ConfiguredGuidance({report}: {report: K6WarningArtifact}) {
  const [headroom, setHeadroom] = useState('20'); const id = useId();
  const {arrival} = report.configuration; const median = report.iteration;
  if (!arrival || !median) return <p>Configured VU guidance requires one arrival scenario and a complete global iteration-duration distribution.</p>;
  const plan = planningWithMedian(median, arrival.peakIterationsPerSecond, headroom.trim() === '' ? NaN : Number(headroom));
  return <><h3>Configured arrival guidance</h3><p>Configured peak: {arrival.peakIterationsPerSecond} iterations/s. Preallocated VUs: {arrival.preAllocatedVUs}; maximum: {arrival.maxVUs}.</p>
    {arrival.executor !== 'constant-arrival-rate' && <p>Ramping/discovery guidance assumes the configured peak rate, not the measured average.</p>}
    <p>Completed iteration median: {median.estimate} ms (histogram bounds {median.lower}–{median.upper} ms; {median.count} samples).</p>
    <label htmlFor={id}>Headroom (%)</label><input id={id} type="number" min="0" max="500" value={headroom} onChange={event => setHeadroom(event.target.value)} />
    {plan.status === 'ready' ? <p>Planning estimate: {plan.vus} VUs. {plan.vus > arrival.maxVUs ? 'Above configured maximum.' : 'Within configured maximum.'}</p> : <p>Enter valid headroom from 0 to 500; the estimate must fit a safe integer.</p>}
    <p>This heuristic excludes unscheduled and interrupted work. It does not establish machine capacity or change your configuration.</p></>;
}
