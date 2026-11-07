import type { CompileInput, SuiteConfig } from '../compiler/generated/types.js';
import type { CompiledLoadPlan, ValidationIssue } from './load.js';
export type { CompileInput, SuiteConfig } from '../compiler/generated/types.js';
export type DeepReadonly<T> = T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export type RequestConfig = SuiteConfig['requests'][number];
export type DatasetConfig = SuiteConfig['datasets'][number];
export type AssertionConfig = RequestConfig['assertions'][number];
export type InputRef = CompileInput['inputs'][number]['ref'];
export type Scalar = Extract<DatasetConfig, { kind: 'inline' }>['rows'][number][string];
export type Row = Readonly<Record<string, Scalar>>;
declare const validatedSuite: unique symbol;
declare const validatedInput: unique symbol;
export type ValidatedSuiteConfig = DeepReadonly<SuiteConfig> & { readonly [validatedSuite]: true };
export type ValidatedCompileInput = DeepReadonly<CompileInput> & { readonly [validatedInput]: true };
export type SuiteIssueCode = ValidationIssue['code'] | 'target' | 'template' | 'missing_dependency'
  | 'conflicting_dependency' | 'input_integrity' | 'input_limit' | 'dataset' | 'csv' | 'assertion'
  | 'readiness' | 'selection' | 'exhausted' | 'digest' | 'random' | 'metric' | 'metric_limit';
export interface SuiteIssue { readonly path: string; readonly code: SuiteIssueCode }
export type Result<T> = { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly issues: readonly SuiteIssue[] };
/** Trusted deterministic SHA-256 dependency; compiler validates encoding, not cryptographic implementation. */
export type Digest = (canonical: string) => string;
export type TemplateToken = { kind: 'literal'; value: string }
  | { kind: 'data'; datasetId: string; column: string }
  | { kind: 'secret'; name: string };
export interface TemplatePlan {
  tokens: TemplateToken[];
  context: 'path' | 'query' | 'header' | 'json' | 'text';
  /** The runtime MUST enforce this after substitution, including secrets and dataset values. */
  safety: 'relative-path' | 'no-crlf' | 'encode-query-component' | 'json-string' | 'text';
  maxRenderedChars: number;
}
export type BodyNode = { kind: 'scalar'; value: Scalar } | { kind: 'template'; template: TemplatePlan }
  | { kind: 'array'; items: BodyNode[] } | { kind: 'object'; entries: { key: string; value: BodyNode }[] };
export type BodyPlan = { kind: 'json'; value: BodyNode }
  | { kind: 'input'; input: InputRef; format: 'text'; value: TemplatePlan }
  | { kind: 'input'; input: InputRef; format: 'json'; value: BodyNode };
export type AssertionPlan<T = AssertionConfig> = T extends { path: string }
  ? Omit<T, 'path'> & { segments: (string | number)[] } : T;
export interface RequestPlan {
  /** Hard output limits the runtime must enforce before allocating serialized requests. */
  serialization: { urlBytes: number; headerBytes: number; bodyBytes: number };
  id: string; name: string; method: RequestConfig['method']; path: TemplatePlan;
  query: { name: string; value: TemplatePlan }[]; headers: { name: string; value: TemplatePlan }[];
  body?: BodyPlan; assertions: AssertionPlan[];
  assertionFailureClass: 'assertion'; transportFailureClass: 'transport';
}
export interface DatasetPlan { id: string; selection: DatasetConfig['selection']; columns: string[]; rows: Row[] }
export type SelectionPlan = SuiteConfig['selections'][number];
export interface ReadinessPlan {
  method: 'GET'; path: TemplatePlan; attempts: number; intervalMs: number; timeoutMs: number;
  wallBudgetMs: number; upperBoundMs: number; expectedStatus: number; assertions: AssertionPlan[];
  exhaustion: 'preparation-failed';
}
export interface CompiledSuite {
  component: 'k6-suite'; compilerVersion: '1.0'; schemaVersion: 1;
  loadPlan: CompiledLoadPlan; target: string; requests: RequestPlan[]; datasets: DatasetPlan[];
  selections: SelectionPlan[]; readiness?: ReadinessPlan;
  identity: { digest: string; engine: CompileInput['engine']; inputs: InputRef[];
    secrets: SuiteConfig['secrets']; reproducibility: 'pinned' | 'unknown' };
}
export interface CompileOptions { input: ValidatedCompileInput; digest: Digest }
