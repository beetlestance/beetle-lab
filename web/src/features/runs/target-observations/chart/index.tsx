import type { TargetMetricName, TargetRuntimeSample } from '@beetle/contracts/target-runtime';

const LEFT = 40;
const RIGHT = 760;
const TOP = 30;
const BOTTOM = 180;

function reading(sample: TargetRuntimeSample, metric: TargetMetricName): number | null {
  const value = sample.values[metric];
  return sample.status === 'ready' && value !== null ? value : null;
}

export function TargetObservationChart({samples, metric}: {samples: readonly TargetRuntimeSample[]; metric: TargetMetricName}) {
  const values = samples.map(sample => reading(sample, metric));
  const times = samples.map(sample => Date.parse(sample.observedAt));
  const measured = values.filter((value, index): value is number => value !== null && Number.isFinite(times[index]));
  if (measured.length === 0) return <NoReadings metric={metric} values={values} />;
  const finiteTimes = times.filter(Number.isFinite);
  const firstTime = Math.min(...finiteTimes);
  const lastTime = Math.max(...finiteTimes);
  const maxValue = Math.max(...measured);
  const x = (time: number) => LEFT + ((time - firstTime) / Math.max(1, lastTime - firstTime)) * (RIGHT - LEFT);
  const y = (value: number) => BOTTOM - (maxValue === 0 ? 0 : value / maxValue) * (BOTTOM - TOP);
  const paths: string[] = [];
  let path = '';
  const flush = () => {if (path) paths.push(path); path = '';};
  let previous: {phase: TargetRuntimeSample['phase']; time: number} | undefined;
  for (const [index, sample] of samples.entries()) {
    const value = values[index]; const time = times[index];
    if (value == null || time === undefined || !Number.isFinite(time)) {flush(); previous = undefined; continue;}
    if (segmentBreak(previous, sample, time)) flush();
    path += `${path ? ' L' : 'M'}${x(time)},${y(value)}`;
    previous = {phase: sample.phase, time};
  }
  if (path) paths.push(path);

  return <section aria-label={`Target-reported ${metric}`}>
    <h3>Target-reported {metric}</h3>
    <TimestampNotice missing={finiteTimes.length < times.length} />
    <svg viewBox="0 0 800 220" role="img" aria-label={`Target-reported ${metric} observations over time`}>
      <line x1={LEFT} y1={BOTTOM} x2={RIGHT} y2={BOTTOM} className="target-observation-axis" />
      {paths.map((data, index) => <path key={index} d={data} className="target-observation-line" />)}
      {samples.map((sample, index) => {
        const value = values[index];
        const time = times[index];
        if (value == null || time === undefined || !Number.isFinite(time)) return null;
        const label = `${sample.observedAt} · ${sample.phase} · target-reported ${metric}: ${value}`;
        return <circle key={`${sample.observedAt}-${index}`} cx={x(time)} cy={y(value)} r="3" className="target-observation-dot">
          <title>{label}</title>
        </circle>;
      })}
    </svg>
  </section>;
}

function segmentBreak(previous: {phase: TargetRuntimeSample['phase']; time: number} | undefined,
  sample: TargetRuntimeSample, time: number): boolean {
  return previous !== undefined && (previous.phase !== sample.phase || time <= previous.time);
}

function NoReadings({metric, values}: {metric: TargetMetricName; values: readonly (number | null)[]}) {
  return <section aria-label={`Target-reported ${metric}`}><h3>Target-reported {metric}</h3>
    <p role="status">{values.some(value => value !== null) ? 'Readings have no plottable observation timestamps.' : 'No readings available for this metric.'}</p></section>;
}
function TimestampNotice({missing}: {missing: boolean}) {
  return missing ? <p role="status">Some observation timestamps cannot be plotted; raw values remain in the observation table.</p> : null;
}
