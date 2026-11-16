import type { Artifact, ExecutionResult, StandaloneExportResult } from './generated/types.js';
import type { ResultDigest, ResultSeal } from './result-seal.js';
import { verifyEngineResultSeal } from './result-seal.js';
import { verifyStandaloneExportResultSeal } from './export-job/index.js';
/** Only validated owned result values may use these structural projections. */
type Inventory = {readonly purpose: 'standalone_export'; readonly artifact: Readonly<Artifact> | null}
  | {readonly artifacts: readonly Readonly<Artifact>[]};
export function executionArtifacts(value: Inventory): readonly Readonly<Artifact>[] {
  return 'purpose' in value ? value.artifact === null ? [] : [value.artifact] : value.artifacts;
}
export function executionEngineId(value: {readonly purpose: 'standalone_export'} | {readonly engineId: string}): string {
  return 'purpose' in value ? 'k6' : value.engineId;
}
export function isExportResult(value: Readonly<ExecutionResult>): value is Readonly<StandaloneExportResult> {
  return 'purpose' in value && value.purpose === 'standalone_export';
}
/** Closed seal codecs, never a caller-supplied validator or execution authority. */
export function verifyExecutionResultSeal(input: unknown, hash: ResultDigest): ResultSeal<ExecutionResult> {
  try {
  const tag=input !== null && typeof input === 'object' ? Object.getOwnPropertyDescriptor(input,'purpose') : undefined;
  return tag && 'value' in tag && tag.value === 'standalone_export'
    ? verifyStandaloneExportResultSeal(input,hash) : verifyEngineResultSeal(input,hash);
  } catch {return {ok:false,code:'invalid_result'};}
}
