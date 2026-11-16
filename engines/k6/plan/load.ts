import type { LoadPlan, Scenario, ThresholdRule } from '../compiler/generated/types.js';
export type { LoadPlan, Scenario, ThresholdRule } from '../compiler/generated/types.js';
type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type ReadonlyLoadPlan = DeepReadonly<LoadPlan>;
export type ReadonlyScenario = DeepReadonly<Scenario>;
declare const validated: unique symbol;
/** Only the unknown-input validation adapter constructs this frozen snapshot. */
export type ValidatedLoadPlan = ReadonlyLoadPlan & { readonly [validated]: true };

export type IssueCode = 'invalid_json' | 'schema' | 'invalid_duration' | 'duration_limit'
  | 'capacity' | 'duplicate_id' | 'duplicate_name' | 'ramp_range' | 'ramp_limit';
export interface ValidationIssue { readonly path: string; readonly code: IssueCode }
export type Checked<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly ValidationIssue[] };

type NativeScenario<S = Exclude<Scenario, { executor: 'ramp-until' }>> = S extends Scenario
  ? Omit<S, 'id' | 'name'> & { exec: string } : never;
export type K6Scenario = NativeScenario;
export interface K6Threshold { threshold: string; abortOnFail: boolean }
export interface K6LoadOptions {
  scenarios: Record<string, K6Scenario>;
  thresholds: Record<string, K6Threshold[]>;
}
export interface ScenarioExecution {
  id: string; name: string; entrypoint: string; executor: Scenario['executor'];
  startOffsetMs: number; activeDurationMs: number; gracefulStopMs: number;
  gracefulRampDownMs: number; upperBoundMs: number;
  iterations?: { mode: 'shared' | 'per-vu'; perVu?: number; total: number };
}
export interface RuleMetadata {
  id: string; kind: 'slo' | 'discovery'; rule: ThresholdRule; threshold: string;
  abortScope: 'none' | 'all-scenarios';
  scenarioId?: string;
}
export interface DiscoveryMetadata {
  scenarioId: string; ruleId: string; abortScope: 'all-scenarios';
  affectedScenarioIds: string[]; companionScenarioIds: string[];
  exhaustionOutcome: 'inconclusive'; requiresObservedRuleFailure: true;
}
export interface CompiledLoadPlan {
  component: 'k6-load-plan'; version: LoadPlan['version']; options: K6LoadOptions;
  execution: { upperBoundMs: number; scenarios: ScenarioExecution[] };
  thresholds: RuleMetadata[]; discovery: DiscoveryMetadata[];
}
