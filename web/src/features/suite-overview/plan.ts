import { executorText } from '../../lib/k6-executors.js';
export { executorText } from '../../lib/k6-executors.js';
/**
 * Client projection of a saved k6 configuration into what the Suite boards show:
 * executor, load shape, stage list, total length, request mix, thresholds and data.
 * Literal values only; anything malformed projects to null instead of a guess.
 */
type Json = Record<string, unknown>;
function record(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;
}
const units = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 } as const;
export function durationMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 12) return null;
  const match = /^(0|[1-9][0-9]{0,8})(ms|s|m|h)$/.exec(value);
  return match ? Number(match[1]) * units[match[2] as keyof typeof units] : null;
}
/** "10:00", "1:05:00"; seconds are floored. */
export function clock(ms: number): string {
  const total = Math.floor(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, '0')}:${seconds}`
    : `${String(minutes).padStart(2, '0')}:${seconds}`;
}
/** "1 min", "90 s", "1 h 30 min". */
export function spoken(ms: number): string {
  if (ms < 60_000 || ms % 60_000 !== 0) return `${Math.round(ms / 1000)} s`;
  const minutes = ms / 60_000;
  if (minutes < 60) return `${minutes} min`;
  const rest = minutes % 60;
  return rest ? `${Math.floor(minutes / 60)} h ${rest} min` : `${minutes / 60} h`;
}
export const figure = (value: number) => value.toLocaleString('en-US');

export type Stage = { kind: 'ramp' | 'steady' | 'drain'; label: string; ms: number; from: number; to: number };
export type Shape = {
  executor: string;
  label: string;
  blurb: string;
  /** "a second" for arrival-rate executors, "VUs" for virtual-user executors. */
  unit: 'a second' | 'VUs' | null;
  stages: Stage[];
  /** Points (time ms, value) for the chart; empty when the executor has no shape. */
  points: [number, number][];
  /** Workload length of this scenario including its start offset; null when it depends on the target. */
  lengthMs: number | null;
  headline: string | null;
};

function perSecond(rate: number, timeUnit: unknown): number | null {
  const unit = durationMs(timeUnit ?? '1s');
  if (!unit) return null;
  return Math.round((rate * 1000) / unit);
}
function stageList(
  start: number,
  stages: unknown,
  unit: string,
  perUnit: (n: number) => number | null,
): Stage[] | null {
  if (!Array.isArray(stages) || stages.length === 0 || stages.length > 128) return null;
  const result: Stage[] = [];
  let previous = start;
  for (const stage of stages) {
    const next = stageOf(stage, previous, unit, perUnit);
    if (!next) return null;
    result.push(next);
    previous = next.to;
  }
  return result;
}
function stageOf(stage: unknown, from: number, unit: string, perUnit: (n: number) => number | null): Stage | null {
  if (!record(stage)) return null;
  const ms = durationMs(stage.duration);
  const target = count(stage.target);
  const to = target === null ? null : perUnit(target);
  if (ms === null || to === null) return null;
  const kind = to > from ? 'ramp' : to < from ? 'drain' : 'steady';
  const label = kind === 'ramp' ? 'Ramp' : kind === 'drain' ? 'Drain' : `Steady at ${figure(to)} ${unit}`;
  return { kind, label, ms, from, to };
}
function headlineOf(stages: Stage[], unit: string): string {
  return stages
    .map((stage) =>
      stage.kind === 'ramp'
        ? `${figure(stage.from)} → ${figure(stage.to)} ${unit} over ${spoken(stage.ms)}`
        : stage.kind === 'drain'
          ? `back down over ${spoken(stage.ms)}`
          : `hold ${spoken(stage.ms)}`,
    )
    .join(', ');
}
function pointsOf(stages: Stage[]): [number, number][] {
  const points: [number, number][] = [[0, stages[0]?.from ?? 0]];
  let at = 0;
  for (const stage of stages) {
    at += stage.ms;
    points.push([at, stage.to]);
  }
  return points;
}
/** Literal open-workload VU limits, shared by the shape and immutable revision differences. */
export function virtualUserLimits(value: Json): { allocated: number; maximum: number } | null {
  const allocated = count(value.preAllocatedVUs);
  const maximum = count(value.maxVUs);
  return allocated !== null && maximum !== null && maximum >= allocated ? { allocated, maximum } : null;
}
function vuRange(value: Json): string | null {
  const limits = virtualUserLimits(value);
  return limits ? `${figure(limits.allocated)} to ${figure(limits.maximum)} VUs` : null;
}
function flat(label: string, value: number, ms: number, unit: string): Stage[] {
  return [{ kind: 'steady', label: `${label} ${figure(value)} ${unit}`, ms, from: value, to: value }];
}
type Built = { unit: Shape['unit']; stages: Stage[] | null; extra: string | null; length: number | null };
const sum = (stages: Stage[] | null) => (stages ? stages.reduce((total, stage) => total + stage.ms, 0) : null);
function constantRate(value: Json): Built {
  const rate = count(value.rate);
  const ms = durationMs(value.duration);
  const per = rate === null ? null : perSecond(rate, value.timeUnit);
  const stages = per === null || ms === null ? null : flat('Steady at', per, ms, 'a second');
  return { unit: 'a second', stages, extra: vuRange(value), length: ms };
}
function rampingRate(value: Json): Built {
  const start = count(value.startRate);
  const toSecond = (n: number) => perSecond(n, value.timeUnit);
  const from = start === null ? null : toSecond(start);
  const stages = from === null ? null : stageList(from, value.stages, 'a second', toSecond);
  return { unit: 'a second', stages, extra: vuRange(value), length: sum(stages) };
}
function rampingVus(value: Json): Built {
  const start = count(value.startVUs);
  const stages = start === null ? null : stageList(start, value.stages, 'VUs', (n) => n);
  return { unit: 'VUs', stages, extra: null, length: sum(stages) };
}
function constantVus(value: Json): Built {
  const vus = count(value.vus);
  const ms = durationMs(value.duration);
  return {
    unit: 'VUs',
    stages: vus === null || ms === null ? null : flat('Hold', vus, ms, 'VUs'),
    extra: null,
    length: ms,
  };
}
function iterations(value: Json): Built {
  const total = count(value.iterations);
  const vus = count(value.vus);
  const max = durationMs(value.maxDuration);
  const extra =
    total !== null && vus !== null
      ? `${figure(total)} iterations across ${figure(vus)} VUs, stopping by ${spoken(max ?? 0)}`
      : null;
  return { unit: null, stages: null, extra, length: max };
}
function rampUntil(value: Json): Built {
  const start = count(value.startRate);
  const max = count(value.maxRate);
  const from = start === null ? null : perSecond(start, value.timeUnit);
  const to = max === null ? null : perSecond(max, value.timeUnit);
  const extra = from !== null && to !== null ? `${figure(from)} → up to ${figure(to)} a second` : null;
  return { unit: null, stages: null, extra, length: null };
}
const builders: Record<string, (value: Json) => Built> = {
  'constant-arrival-rate': constantRate,
  'ramping-arrival-rate': rampingRate,
  'ramping-vus': rampingVus,
  'constant-vus': constantVus,
  'shared-iterations': iterations,
  'per-vu-iterations': iterations,
  'ramp-until': rampUntil,
};
function scenarioShape(value: unknown): Shape | null {
  if (!record(value) || typeof value.executor !== 'string' || !Object.hasOwn(builders, value.executor)) return null;
  const text = executorText[value.executor];
  const build = builders[value.executor];
  if (!text || !build) return null;
  const offset = durationMs(value.startTime ?? '0s') ?? 0;
  return { executor: value.executor, ...text, ...shapeOf(build(value), offset) };
}
function shapeOf({ unit, stages, extra, length }: Built, offset: number) {
  const list = stages ?? [];
  const head = list.length && unit ? headlineOf(list, unit) : null;
  return {
    unit,
    stages: list,
    points: list.length ? pointsOf(list) : [],
    lengthMs: length === null ? null : offset + length,
    headline: [head, extra].filter(Boolean).join('; ') || null,
  };
}
export type PlanSummary = {
  first: Shape | null;
  scenarios: number;
  /** Longest scenario end; null if any scenario's length depends on the target. */
  totalMs: number | null;
  requestCount: number | null;
};
export function planSummary(config: Json): PlanSummary {
  const plan = config.loadPlan;
  const scenarios = record(plan) && Array.isArray(plan.scenarios) && plan.scenarios.length <= 64 ? plan.scenarios : [];
  const shapes = scenarios.map(scenarioShape);
  const lengths = shapes.map((shape) => shape?.lengthMs ?? null);
  const requests = Array.isArray(config.requests) && config.requests.length <= 64 ? config.requests.length : null;
  return {
    first: shapes[0] ?? null,
    scenarios: scenarios.length,
    totalMs: lengths.length && lengths.every((value) => value !== null) ? Math.max(...(lengths as number[])) : null,
    requestCount: requests,
  };
}
