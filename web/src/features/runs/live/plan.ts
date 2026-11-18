/**
 * Reads the saved k6 configuration (an untyped record on SuiteRevision) into the
 * pieces the live view draws: stage plan, request labels and thresholds. Every
 * field is checked; anything unreadable becomes null and the view hides it.
 */
import { captureTargetRuntimeUnits } from '@beetle/contracts/target-runtime';
import type { TargetRuntimeUnits } from '@beetle/contracts/target-runtime';
export interface PlanStage {
  readonly label: string;
  readonly startMs: number;
  readonly durationMs: number;
  readonly drain: boolean;
}
export interface PlanRequest {
  /** k6 catalogue label: `r${index}` in the revision's request order. */
  readonly label: string;
  readonly name: string;
  readonly method: string;
  readonly path: string;
}
export interface PlanRule {
  readonly id: string;
  readonly metric: string;
  readonly stat: string;
  readonly operator: '<' | '<=' | '>' | '>=';
  readonly value: number;
}
export interface RunPlan {
  /** Stage segments for a single-scenario plan; empty when the timing is not fixed. */
  readonly stages: readonly PlanStage[];
  /** Planned length including the drain, or null when the plan has no fixed length. */
  readonly totalMs: number | null;
  readonly unit: 'rate' | 'vus' | null;
  readonly maxVus: number | null;
  readonly requests: readonly PlanRequest[];
  readonly rules: readonly PlanRule[];
  readonly targetOrigin: string | null;
  readonly samplingIntervalMs: number | null;
  readonly targetUnits?: TargetRuntimeUnits;
}

type Data = Record<string, unknown>;
const record = (value: unknown): value is Data => value !== null && typeof value === 'object' && !Array.isArray(value);
const integer = (value: unknown): number | null =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : null;

export function durationMs(value: unknown): number | null {
  if (typeof value !== 'string' || value.length > 12) return null;
  const match = /^(0|[1-9][0-9]{0,8})(ms|s|m|h)$/.exec(value);
  if (!match) return null;
  const scale = { ms: 1, s: 1000, m: 60_000, h: 3_600_000 }[match[2] as 'ms' | 's' | 'm' | 'h'];
  return Number(match[1]) * scale;
}

const perSecond = (rate: number, unitMs: number) => (rate * 1000) / unitMs;
const count = (value: number) => Math.round(value).toLocaleString('en-US');

function rampLabel(from: number, to: number, unit: 'rate' | 'vus'): string {
  const amount = unit === 'rate' ? `${count(to)} a second` : `${count(to)} virtual users`;
  if (to === from) return unit === 'rate' ? `Steady at ${amount}` : `Hold ${amount}`;
  return to > from ? `Ramp to ${amount}` : `Ramp down to ${amount}`;
}

interface Scenario {
  stages: PlanStage[];
  lengthMs: number | null;
  unit: 'rate' | 'vus' | null;
  maxVus: number | null;
}

function stagesFrom(
  list: unknown,
  start: number,
  unit: 'rate' | 'vus',
  scale: (n: number) => number,
): PlanStage[] | null {
  if (!Array.isArray(list) || list.length === 0 || list.length > 128) return null;
  const stages: PlanStage[] = [];
  let at = 0;
  let previous = start;
  for (const item of list) {
    const length = record(item) ? durationMs(item.duration) : null;
    const target = record(item) ? integer(item.target) : null;
    if (length === null || target === null) return null;
    stages.push({ label: rampLabel(previous, scale(target), unit), startMs: at, durationMs: length, drain: false });
    at += length;
    previous = scale(target);
  }
  return stages;
}

type ToRate = (n: number) => number;

/** One fixed-length stage; null when the length or level cannot be read. */
function single(length: number | null, level: number | null, label: (n: number) => string) {
  if (length === null || level === null) return null;
  return [{ label: label(level), startMs: 0, durationMs: length, drain: false }];
}

function constantArrival(value: Data, toRate: ToRate): Scenario | null {
  const stages = single(
    durationMs(value.duration),
    integer(value.rate),
    (n) => `Steady at ${count(toRate(n))} a second`,
  );
  return stages && { stages, lengthMs: sum(stages), unit: 'rate', maxVus: integer(value.maxVUs) };
}

function rampingArrival(value: Data, toRate: ToRate): Scenario | null {
  const stages = stagesFrom(value.stages, toRate(integer(value.startRate) ?? 0), 'rate', toRate);
  return stages && { stages, lengthMs: sum(stages), unit: 'rate', maxVus: integer(value.maxVUs) };
}

function rampingVus(value: Data): Scenario | null {
  const start = integer(value.startVUs) ?? 0;
  const stages = stagesFrom(value.stages, start, 'vus', (n) => n);
  if (!stages) return null;
  const peak = Math.max(start, ...(value.stages as Data[]).map((s) => integer(s.target) ?? 0));
  return { stages, lengthMs: sum(stages), unit: 'vus', maxVus: peak };
}

function constantVus(value: Data): Scenario | null {
  const vus = integer(value.vus);
  const stages = single(durationMs(value.duration), vus, (n) => `Hold ${count(n)} virtual users`);
  return stages && { stages, lengthMs: sum(stages), unit: 'vus', maxVus: vus };
}

function scenarioPlan(value: Data): Scenario | null {
  const unitMs = durationMs(value.timeUnit) ?? 1000;
  const toRate = (n: number) => perSecond(n, Math.max(1, unitMs));
  switch (value.executor) {
    case 'constant-arrival-rate':
      return constantArrival(value, toRate);
    case 'ramping-arrival-rate':
      return rampingArrival(value, toRate);
    case 'ramping-vus':
      return rampingVus(value);
    case 'constant-vus':
      return constantVus(value);
    default:
      // Iteration and ramp-until executors stop on their own terms: no fixed length.
      return { stages: [], lengthMs: null, unit: null, maxVus: integer(value.maxVUs) ?? integer(value.vus) };
  }
}

const sum = (stages: readonly PlanStage[]) => stages.reduce((total, stage) => total + stage.durationMs, 0);

function scenariosOf(config: Data): Data[] | null {
  const plan = config.loadPlan;
  if (!record(plan) || !Array.isArray(plan.scenarios) || plan.scenarios.length === 0 || plan.scenarios.length > 64)
    return null;
  return plan.scenarios.every(record) ? plan.scenarios : null;
}

function timing(config: Data): Pick<RunPlan, 'stages' | 'totalMs' | 'unit' | 'maxVus'> {
  const scenarios = scenariosOf(config);
  const none = { stages: [], totalMs: null, unit: null, maxVus: null };
  if (!scenarios) return none;
  const plans = scenarios.map(scenarioPlan);
  if (plans.some((plan) => plan === null)) return none;
  const known = plans as Scenario[];
  const vus = known.map((plan) => plan.maxVus);
  const maxVus = vus.every((v) => v !== null) ? (vus as number[]).reduce((a, b) => a + b, 0) : null;
  if (scenarios.length > 1) {
    const ends = scenarios.map((scenario, index) => {
      const length = known[index]!.lengthMs;
      const offset = durationMs(scenario.startTime);
      const grace = durationMs(scenario.gracefulStop) ?? 0;
      return length === null || offset === null ? null : offset + length + grace;
    });
    const totalMs = ends.every((end) => end !== null) ? Math.max(...(ends as number[])) : null;
    return { stages: [], totalMs, unit: null, maxVus };
  }
  const scenario = scenarios[0]!;
  const plan = known[0]!;
  const offset = durationMs(scenario.startTime) ?? 0;
  if (plan.lengthMs === null) return { ...none, maxVus };
  const shifted = plan.stages.map((stage) => ({ ...stage, startMs: stage.startMs + offset }));
  const grace = durationMs(scenario.gracefulStop) ?? 0;
  const end = offset + plan.lengthMs;
  const stages = grace > 0 ? [...shifted, { label: 'Drain', startMs: end, durationMs: grace, drain: true }] : shifted;
  return { stages, totalMs: end + grace, unit: plan.unit, maxVus };
}

function requests(config: Data): PlanRequest[] {
  if (!Array.isArray(config.requests) || config.requests.length > 64) return [];
  return config.requests.flatMap((item, index) =>
    record(item) && typeof item.name === 'string' && typeof item.method === 'string' && typeof item.path === 'string'
      ? [{ label: `r${index}`, name: item.name, method: item.method, path: item.path }]
      : [],
  );
}

const operators = new Set(['<', '<=', '>', '>=']);
function rules(config: Data): PlanRule[] {
  const plan = config.loadPlan;
  if (!record(plan) || !Array.isArray(plan.slos) || plan.slos.length > 128) return [];
  return plan.slos.flatMap((rule) =>
    record(rule) &&
    typeof rule.id === 'string' &&
    typeof rule.metric === 'string' &&
    typeof rule.stat === 'string' &&
    typeof rule.operator === 'string' &&
    operators.has(rule.operator) &&
    typeof rule.value === 'number' &&
    Number.isFinite(rule.value)
      ? [
          {
            id: rule.id,
            metric: rule.metric,
            stat: rule.stat,
            operator: rule.operator as PlanRule['operator'],
            value: rule.value,
          },
        ]
      : [],
  );
}

function origin(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 4096) return null;
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.host : null;
  } catch {
    return null;
  }
}

export function readPlan(config: unknown): RunPlan {
  const data = record(config) ? config : {};
  const sampling = record(data.targetSampling) ? integer(data.targetSampling.intervalMs) : null;
  return {
    ...timing(data),
    requests: requests(data),
    rules: rules(data),
    targetOrigin: origin(data.target),
    samplingIntervalMs: sampling,
    ...unitDeclarations(data.targetSampling),
  };
}

function unitDeclarations(sampling: unknown): Pick<RunPlan, 'targetUnits'> {
  if (!record(sampling) || sampling.units === undefined) return {};
  try {
    return { targetUnits: captureTargetRuntimeUnits(sampling.units) };
  } catch {
    return {};
  }
}

/** The stage containing `elapsedMs`, or null outside the plan. */
export function stageAt(plan: RunPlan, elapsedMs: number): PlanStage | null {
  return (
    plan.stages.find((stage) => elapsedMs >= stage.startMs && elapsedMs < stage.startMs + stage.durationMs) ?? null
  );
}
