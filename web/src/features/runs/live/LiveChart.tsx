import type { PointerEvent, ReactNode } from 'react';
import { clock } from './format.js';

export type SeriesTone = 'ink' | 'amber' | 'info' | 'violet' | 'fail' | 'mute';
export interface ChartSeries {
  readonly key: string;
  readonly label: string;
  readonly tone: SeriesTone;
  readonly values: readonly (number | null)[];
  readonly area?: boolean | undefined;
  readonly dashed?: boolean | undefined;
}
export interface ChartTick {
  readonly at: number;
  readonly label: string;
  /** Desktop phase annotation; phone keeps the boundary and current-time labels. */
  readonly detail?: boolean;
}
export interface ChartProps {
  readonly title: ReactNode;
  readonly xs: readonly number[];
  /** Index i starts a new line segment (a gap in the readings before it). */
  readonly breaks?: readonly boolean[] | undefined;
  readonly domain: readonly [number, number];
  readonly series: readonly ChartSeries[];
  readonly format: (value: number) => string;
  readonly limit?: { readonly value: number; readonly label: string } | undefined;
  readonly bands?: readonly { readonly from: number; readonly to: number }[] | undefined;
  readonly ticks?: readonly ChartTick[] | undefined;
  readonly hoverT?: number | null | undefined;
  readonly onHover?: ((t: number | null) => void) | undefined;
  readonly className?: string | undefined;
  readonly tall?: boolean | undefined;
}

const W = 600;
const niceCeiling = (value: number) => {
  if (value <= 0) return 1;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * power >= value) ?? 10;
  return step * power;
};

export function nearestIndex(xs: readonly number[], t: number): number {
  let best = -1;
  let distance = Number.POSITIVE_INFINITY;
  xs.forEach((x, i) => {
    const d = Math.abs(x - t);
    if (d < distance) {
      best = i;
      distance = d;
    }
  });
  return best;
}

interface Scale {
  readonly H: number;
  readonly yMax: number;
  readonly x: (t: number) => number;
  readonly y: (v: number) => number;
}

function scaleOf(props: ChartProps): Scale {
  const H = props.tall ? 220 : 150;
  const measured = props.series.flatMap((s) => s.values.filter((v): v is number => v !== null));
  const yMax = niceCeiling(Math.max(props.limit?.value ?? 0, ...measured, 0) * 1.1);
  const [x0, x1] = props.domain;
  return {
    H,
    yMax,
    x: (t: number) => ((t - x0) / Math.max(1, x1 - x0)) * W,
    y: (v: number) => H - (v / yMax) * (H - 8),
  };
}

type LegendEntry = { s: ChartSeries; value: number | null };

function Legend({ entries, format }: { entries: readonly LegendEntry[]; format: ChartProps['format'] }) {
  return (
    <span className="live-legend">
      {entries.map(({ s, value }) => (
        <span key={s.key} className={`live-key tone-${s.tone}`}>
          {s.label} <strong>{value === null ? '–' : format(value)}</strong>
        </span>
      ))}
    </span>
  );
}

function SeriesPaths({ props, scale }: { props: ChartProps; scale: Scale }) {
  return props.series.map((s) =>
    linePath(props.xs, s.values, props.breaks, scale.x, scale.y).map((d, j) => (
      <g key={`${s.key}-${j}`} className={`live-series tone-${s.tone}${s.dashed ? ' dashed' : ''}`}>
        {s.area && <path className="live-area" d={`${d.line} L${d.lastX},${scale.H} L${d.firstX},${scale.H} Z`} />}
        <path className="live-line" d={d.line} vectorEffect="non-scaling-stroke" />
        {d.firstX === d.lastX && (
          <circle className="live-single-point" cx={d.firstX} cy={d.lastY} r={2.5} fill="var(--key)" />
        )}
      </g>
    )),
  );
}

function Guides({ props, scale }: { props: ChartProps; scale: Scale }) {
  const { x, y, H, yMax } = scale;
  return (
    <>
      {props.bands?.map((band) => (
        <rect
          key={`${band.from}`}
          className="live-band"
          x={x(band.from)}
          y={0}
          width={Math.max(0, x(band.to) - x(band.from))}
          height={H}
        />
      ))}
      <line className="live-grid" x1={0} x2={W} y1={y(yMax / 2)} y2={y(yMax / 2)} />
      {props.limit && (
        <line className="live-limit" x1={0} x2={W} y1={y(props.limit.value)} y2={y(props.limit.value)}>
          <title>{props.limit.label}</title>
        </line>
      )}
    </>
  );
}

function Ticks({ props, scale }: { props: ChartProps; scale: Scale }) {
  return (
    <span className="live-ticks" aria-hidden="true">
      {(props.ticks ?? defaultTicks(props.domain)).map((tick) => (
        <span
          className={tick.detail ? 'live-tick-detail' : undefined}
          key={tick.label + tick.at}
          style={{ left: `${(scale.x(tick.at) / W) * 100}%` }}
        >
          {tick.label}
        </span>
      ))}
    </span>
  );
}

function hoverHandlers(props: ChartProps) {
  const onHover = props.onHover;
  if (!onHover) return {};
  const [x0, x1] = props.domain;
  return {
    onPointerMove: (event: PointerEvent<SVGSVGElement>) => {
      const box = event.currentTarget.getBoundingClientRect();
      if (box.width <= 0) return;
      onHover(x0 + ((event.clientX - box.left) / box.width) * (x1 - x0));
    },
    onPointerLeave: () => onHover(null),
  };
}

function legendOf(props: ChartProps): { entries: LegendEntry[]; index: number } {
  const { xs, hoverT } = props;
  const index = hoverT == null ? xs.length - 1 : nearestIndex(xs, hoverT);
  const entries = props.series.map((s) => ({ s, value: index >= 0 ? (s.values[index] ?? null) : null }));
  return { entries, index };
}

/**
 * Line chart for live readings over a fixed run timeline. Missing values break
 * the line; nothing is interpolated across a gap. The legend shows the latest
 * reading, or the reading at the pointed-at second when a chart is hovered.
 */
export function LiveChart(props: ChartProps) {
  const { xs, format } = props;
  const scale = scaleOf(props);
  const { entries, index } = legendOf(props);
  const label = entries.map(({ s, value }) => `${s.label} ${value === null ? 'no reading' : format(value)}`).join(', ');
  const title = typeof props.title === 'string' ? props.title : 'Chart';
  const cursor = props.hoverT != null && index >= 0 ? scale.x(xs[index]!) : null;
  return (
    <figure className={['live-chart', props.className].filter(Boolean).join(' ')}>
      <figcaption className="live-chart-head">
        <span className="live-chart-title">{props.title}</span>
        <Legend entries={entries} format={format} />
      </figcaption>
      <span className="live-chart-max">{format(scale.yMax)}</span>
      <svg
        viewBox={`0 0 ${W} ${scale.H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${title}: ${label}`}
        {...hoverHandlers(props)}
        style={{ height: scale.H }}
      >
        <Guides props={props} scale={scale} />
        <SeriesPaths props={props} scale={scale} />
        {cursor !== null && <line className="live-cursor" x1={cursor} x2={cursor} y1={0} y2={scale.H} />}
      </svg>
      <Ticks props={props} scale={scale} />
    </figure>
  );
}

function defaultTicks([from, to]: readonly [number, number]): ChartTick[] {
  return [
    { at: from, label: clock(from) },
    { at: (from + to) / 2, label: clock((from + to) / 2) },
    { at: to, label: clock(to) },
  ];
}

interface Segment {
  line: string;
  firstX: number;
  lastX: number;
  lastY: number;
}
function linePath(
  xs: readonly number[],
  values: readonly (number | null)[],
  breaks: readonly boolean[] | undefined,
  x: (t: number) => number,
  y: (v: number) => number,
): Segment[] {
  const segments: Segment[] = [];
  let current: Segment | null = null;
  values.forEach((value, i) => {
    if (value === null || breaks?.[i]) {
      if (current) segments.push(current);
      current = null;
      if (value === null) return;
    }
    const px = x(xs[i]!);
    const py = y(value);
    if (current) {
      current.line += ` L${px},${py}`;
      current.lastX = px;
      current.lastY = py;
    } else current = { line: `M${px},${py}`, firstX: px, lastX: px, lastY: py };
  });
  if (current) segments.push(current);
  return segments;
}
