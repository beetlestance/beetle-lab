import type { RunMetricPoint, RunMetricSeries, RunMetricValue } from '@beetle/contracts/api';
export function valueNumber(v: RunMetricValue): number | null {
  switch (v.kind) {
    case 'counter': return v.sum;
    case 'rate': return v.ratio;
    case 'gauge': return v.latest;
    case 'trend': return v.percentiles.p95.estimate;
  }
}
export function MetricChart({items, series}: {items: readonly RunMetricPoint[]; series: RunMetricSeries}) {
  const values = items.map(p => valueNumber(p.value)); const measured = values.filter((v): v is number => v !== null);
  if (!items.length) return <p role="status">No samples for this series in the examined source windows.</p>;
  const samples = <details><summary>Source samples and estimate bounds</summary><div className="metric-table" tabIndex={0} role="region" aria-label="Metric samples">
    <table><thead><tr><th scope="col">Source interval (ms)</th><th scope="col">Value ({series.unit})</th><th scope="col">Evidence</th><th scope="col">Source interval (UTC)</th></tr></thead>
      <tbody>{items.map(p => <tr key={p.windowOrdinal}><td>{p.startTimeMs}–{p.endTimeMs}</td><td>{valueNumber(p.value) ?? 'No samples'}</td>
        <td>{evidence(p.value)}</td><td><time dateTime={new Date(p.startTimeMs).toISOString()}>{new Date(p.startTimeMs).toISOString()}</time> – <time dateTime={new Date(p.endTimeMs).toISOString()}>{new Date(p.endTimeMs).toISOString()}</time></td></tr>)}</tbody></table></div></details>;
  if (!measured.length) return <><p role="status">No measured values in these source windows.</p>{samples}</>;
  const first = items[0]!.startTimeMs; const last = items.at(-1)!.endTimeMs;
  const lowValue = Math.min(0, ...measured); const highValue = Math.max(0, ...measured);
  const min = lowValue === highValue ? 0 : lowValue; const max = lowValue === highValue ? 1 : highValue;
  const x = (t: number) => 40 + ((t - first) / Math.max(1, last - first)) * 700;
  const y = (v: number) => 170 - ((v - min) / (max - min)) * 140;
  const segments: string[] = []; let segment = '';
  items.forEach((point, index) => {
    const v = values[index]; const prev = items[index - 1];
    if (v === null || v === undefined) {if (segment) segments.push(segment); segment = ''; return;}
    if (prev && (prev.endTimeMs !== point.startTimeMs || prev.windowOrdinal + 1 !== point.windowOrdinal)) {
      if (segment) segments.push(segment); segment = '';
    }
    segment += `${segment ? ' L' : 'M'}${x(point.startTimeMs)},${y(v)}`;
  });
  if (segment) segments.push(segment);
  return <><svg className="metric-chart" viewBox="0 0 780 210" role="img" aria-label={`${series.metric} source window chart; gaps are unmeasured`}>
    <line x1="40" y1={y(0)} x2="740" y2={y(0)} className="metric-axis" />
    <text x="4" y="28">{max.toPrecision(3)}</text><text x="4" y="174">{min.toPrecision(3)}</text>
    {segments.map((d, i) => <path key={i} d={d} className="metric-line" />)}
    {items.map((p, i) => values[i] === null ? null : <circle key={p.windowOrdinal} cx={x(p.startTimeMs)} cy={y(values[i]!)} r="3" className="metric-dot">
      <title>{p.startTimeMs}: {values[i]} {series.unit}</title></circle>)}
    <text x="40" y="200">{new Date(first).toISOString()}</text><text x="740" y="200" textAnchor="end">{new Date(last).toISOString()}</text>
  </svg>{samples}</>;
}
export function evidence(v: RunMetricValue): string {
  if (v.kind === 'trend') {const p = v.percentiles.p95; return `Estimated p95; bounds ${p.lower}–${p.upper} ms; scale ${p.scale}; ${v.count} samples`;}
  if (v.kind === 'rate') return `${v.numerator} / ${v.sampleCount} samples`;
  if (v.kind === 'counter') return 'Source-second bucket count';
  return `Latest source time ${v.sourceTimeMs}; min ${v.min}; max ${v.max}`;
}
