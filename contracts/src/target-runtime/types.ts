import type { TargetRuntimeReport as WireReport } from '../generated/types.js';
import type { TargetRuntimeUnits as WireUnits } from '../generated/types.js';
export type TargetRuntimeUnits = Readonly<WireUnits>;

type WireSample = WireReport['samples'][number];
export type TargetMetricName = keyof WireSample['values'];
export type TargetRuntimePhase = WireSample['phase'];
export type TargetRuntimeReason = NonNullable<WireSample['reason']>;
export type TargetRuntimeSample = Readonly<Omit<WireSample, 'values'>> & {
  readonly values: Readonly<WireSample['values']>;
};
export type TargetRuntimeReport = Readonly<Omit<WireReport, 'samples' | 'units'>> & {
  readonly units?: TargetRuntimeUnits;
  readonly samples: readonly TargetRuntimeSample[];
};
