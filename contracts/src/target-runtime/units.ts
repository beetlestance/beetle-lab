import { encodeCanonicalJson } from '../json.js';
import { validate } from '../validate.js';
import type { TargetMetricName, TargetRuntimeUnits } from './types.js';
export type TargetUnit = NonNullable<TargetRuntimeUnits[TargetMetricName]>;
type Dimension = 'memory' | 'time' | 'cpu' | 'count';
const definitions: Record<TargetUnit, readonly [Dimension, number, string]> = {
  bytes: ['memory', 1, 'B'],
  kibibytes: ['memory', 1024, 'KiB'],
  mebibytes: ['memory', 1048576, 'MiB'],
  kilobytes: ['memory', 1000, 'kB'],
  megabytes: ['memory', 1000000, 'MB'],
  nanoseconds: ['time', 0.000001, 'ns'],
  microseconds: ['time', 0.001, 'µs'],
  milliseconds: ['time', 1, 'ms'],
  seconds: ['time', 1000, 's'],
  percent: ['cpu', 1, '%'],
  ratio: ['cpu', 100, 'ratio'],
  count: ['count', 1, 'count'],
};
const preferredUnits: Record<Dimension, TargetUnit> = {
  memory: 'mebibytes',
  time: 'milliseconds',
  cpu: 'percent',
  count: 'count',
};
export interface TargetUnitProjection {
  readonly factor: number;
  readonly label: string;
  readonly declared: boolean;
}

/** Operator declaration, not inferred from metric names or reported magnitudes. */
export function captureTargetRuntimeUnits(input: unknown): TargetRuntimeUnits {
  const snapshot: unknown = JSON.parse(encodeCanonicalJson(input, 4096));
  const result = validate('TargetRuntimeUnits', snapshot);
  if (!result.ok) throw new Error('Invalid target runtime units');
  return Object.freeze(result.value);
}

/** Missing declarations stay raw; only compatible declared dimensions convert. */
export function targetUnitProjection(
  units: TargetRuntimeUnits | undefined,
  metric: TargetMetricName,
  preferred?: TargetUnit,
): TargetUnitProjection {
  const source = units?.[metric];
  if (source === undefined) return Object.freeze({ factor: 1, label: 'source units (not declared)', declared: false });
  const [dimension, factor] = definitions[source];
  const output = definitions[preferred ?? preferredUnits[dimension]];
  if (output[0] !== dimension) throw new Error('Incompatible target display unit');
  return Object.freeze({ factor: factor / output[1], label: output[2], declared: true });
}

export function projectTargetReading(value: number | null, projection: TargetUnitProjection): number | null {
  if (value === null) return null;
  const converted = value * projection.factor;
  if (value !== 0 && converted === 0) return null;
  return Number.isFinite(converted) ? converted : null;
}
