/** Actual metric-window values shared by live and recorded presentation. */
export interface MetricChartPoint {
  readonly t: number;
  readonly gapBefore: boolean;
  readonly rps: number | null;
  readonly p50: number | null;
  readonly p95: number | null;
  readonly p99: number | null;
  readonly failedPerSecond: number | null;
  readonly vus: number | null;
  readonly vusMax: number | null;
}

export interface ChartHover {
  readonly hoverT: number | null;
  readonly onHover: (t: number | null) => void;
}
