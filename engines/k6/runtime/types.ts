import type { CompiledSuite, CounterName, DeepReadonly, RequestPlan } from '../plan/index.js';

export interface RuntimeLimits {
  responseProcessingBytes: number;
  responseJsonNodes: number;
  responseJsonDepth: number;
  secretBytes: number;
  aggregateSecretBytes: number;
  requestTimeoutMs: number;
}
export interface HttpRequest {
  method: RequestPlan['method']; url: string; headers: Readonly<Record<string, string>>;
  body: string | null; timeoutMs: number; responseType: 'text' | 'none'; label: string;
}
export interface HttpResponse {
  status: number; headers: Readonly<Record<string, string>>; body: string | null;
  transportFailed: boolean;
}
export interface RuntimeAdapters {
  now(): number;
  random(): number;
  sleep(milliseconds: number): void;
  http(request: HttpRequest): HttpResponse;
  metric(name: CounterName, value: number, tags: Readonly<Record<string, string>>): void;
}
export type RuntimeCode = 'request_limit' | 'secret' | 'path' | 'header' | 'deadline'
  | 'adapter' | 'preparation' | 'selection' | 'exhausted' | 'invalid_limits';
export type IterationResult = { kind: 'completed' | 'assertion' | 'transport' | 'execution';
  requiredFailures: number; optionalFailures: number; code?: RuntimeCode };
export interface RuntimeInput {
  suite: DeepReadonly<CompiledSuite>; adapters: RuntimeAdapters;
  /** Trusted resolver: approved names only, <=64KiB/value and <=1MiB across names. */
  resolveSecret(name: string): string;
  limits?: Partial<RuntimeLimits>;
}
export interface IterationPosition { scenarioId: string; vu: number; iteration: number; deadlineMs: number }
export interface Runtime {
  prepare(deadlineMs: number): void;
  iterate(position: IterationPosition): IterationResult;
}
