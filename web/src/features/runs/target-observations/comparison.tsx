import type { observationSummary } from './summary.js';
export function TargetPointComparison({summary}: {summary: ReturnType<typeof observationSummary>}) {
  return <>
    {(!summary.clockOrdered || !summary.phaseOrdered) && <p role="status">Observation times or phases are inconsistent; comparisons are unavailable.</p>}
    <dl className="run-facts" aria-label="Target point comparison">
      <div><dt>Before point</dt><dd>{summary.baseline ?? 'Unavailable'}</dd></div>
      <div><dt>Observed during peak</dt><dd>{summary.peak ?? 'Unavailable'}</dd></div>
      <div><dt>Last after point</dt><dd>{summary.final ?? 'Unavailable'}</dd></div>
      <div><dt>After minus before</dt><dd>{summary.delta ?? 'Unavailable'}</dd></div>
      <div><dt>After change from before (%)</dt><dd>{summary.percent === null ? 'Unavailable' : summary.percent.toPrecision(4) + '%'}</dd></div>
    </dl>
    <p>Before is a single point observation; a steady baseline needs repeated measurements. Source field names and units are preserved.</p>
    {summary.final === null && <p>No usable last after point was recorded; cooldown recovery is unknown.</p>}
    {summary.investigateMemory && <p>The last after point remains above the before point. Treat this as a follow-up signal; repeatable baselines are needed to assess a leak.</p>}
  </>;
}
