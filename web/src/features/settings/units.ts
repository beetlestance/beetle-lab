import type { Budget, PoolCapacity } from '@beetle/contracts/api';

/** A numeric setting shown in a friendly unit and stored as a whole number of base units. */
export interface Unit {
  /** Shown after the field: min, GB, CPUs. */
  label: string;
  /** Base units per display unit, for example 60000 milliseconds per minute. */
  factor: number;
}

export const units = {
  minutes: { label: 'min', factor: 60_000 },
  gigabytes: { label: 'GB', factor: 1_000_000_000 },
  cpus: { label: 'CPUs', factor: 1000 },
  procs: { label: 'procs', factor: 1 },
  runs: { label: 'runs', factor: 1 },
  days: { label: 'days', factor: 1 },
} satisfies Record<string, Unit>;

export interface NumericCopy {
  label: string;
  help: string;
  unit: Unit;
}

/** Per-run budget rows, in the board's order. */
export const budgetCopy: Record<keyof Budget, NumericCopy> = {
  timeoutMs: {
    label: 'Longest run allowed',
    help: 'Runs stop at this limit even if their plan is longer.',
    unit: units.minutes,
  },
  memoryBytes: {
    label: 'Memory per run',
    help: 'A run that goes over is stopped and marked out of memory.',
    unit: units.gigabytes,
  },
  cpuMillis: { label: 'CPU per run', help: 'At this limit k6 is slowed down, not stopped.', unit: units.cpus },
  pids: { label: 'Processes per run', help: 'Stops a runaway engine from forking without end.', unit: units.procs },
  outputBytes: {
    label: 'Output per run',
    help: 'Metrics, logs and target samples one run may write. Past this the run stops with its output full.',
    unit: units.gigabytes,
  },
};
export const budgetOrder = ['timeoutMs', 'memoryBytes', 'cpuMillis', 'pids', 'outputBytes'] as const;

/** Shared capacity rows (Settings / Installation / Capacity). */
export const poolCopy: Record<keyof PoolCapacity, NumericCopy> = {
  concurrency: {
    label: 'Runs at once',
    help: 'More runs wait in the queue. A value above what the host reports is refused.',
    unit: units.runs,
  },
  memoryBytes: {
    label: 'Memory for all runs',
    help: 'Shared by running runs. Lowering it below what they hold stops new starts, never running work.',
    unit: units.gigabytes,
  },
  cpuMillis: {
    label: 'CPU for all runs',
    help: 'Shared by running runs. Each run also has its own CPU limit.',
    unit: units.cpus,
  },
  pids: { label: 'Processes for all runs', help: 'Shared by running runs.', unit: units.procs },
  outputBytes: {
    label: 'Output for all runs',
    help: 'Space running runs may write to at once.',
    unit: units.gigabytes,
  },
  storageBytes: { label: 'Storage kept for results', help: 'Finished results and artifacts.', unit: units.gigabytes },
  freeSpaceReserveBytes: {
    label: 'Disk always left free',
    help: 'Kept free for the host; results never use it.',
    unit: units.gigabytes,
  },
};
export const poolOrder = [
  'concurrency',
  'memoryBytes',
  'cpuMillis',
  'pids',
  'outputBytes',
  'storageBytes',
  'freeSpaceReserveBytes',
] as const;

/** Per-run ceilings: the most any level may set for one run. */
const ceilingLabels: Record<keyof Budget, string> = {
  timeoutMs: 'Longest run any level may set',
  memoryBytes: 'Most memory per run',
  cpuMillis: 'Most CPU per run',
  pids: 'Most processes per run',
  outputBytes: 'Most output per run',
};
export const ceilingCopy = Object.fromEntries(
  budgetOrder.map((key) => [
    key,
    { ...budgetCopy[key], label: ceilingLabels[key], help: 'No level can set a per-run value above this.' },
  ]),
) as Record<keyof Budget, NumericCopy>;

/** Exact display: whole numbers stay whole; other values keep up to six significant digits. */
export function toUnit(base: number, unit: Unit): string {
  const value = base / unit.factor;
  return Number.isInteger(value) ? String(value) : String(Number(value.toPrecision(6)));
}

/**
 * Parses a canonical decimal in the display unit into whole base units, exactly (BigInt).
 * Returns undefined when the text is not a canonical decimal or the result is not whole.
 */
export function fromUnit(text: string, unit: Unit): number | undefined {
  const match = /^(0|[1-9][0-9]*)(?:\.([0-9]+))?$/.exec(text);
  if (!match) return undefined;
  const fraction = match[2] ?? '';
  const scale = 10n ** BigInt(fraction.length);
  const numerator = (BigInt(match[1]!) * scale + BigInt(fraction || '0')) * BigInt(unit.factor);
  if (numerator % scale !== 0n) return undefined;
  const base = numerator / scale;
  return base <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(base) : undefined;
}

export function rangeText(minimum: number, maximum: number, unit: Unit): string {
  return `Enter ${toUnit(minimum, unit)} to ${toUnit(maximum, unit)} ${unit.label}.`;
}
