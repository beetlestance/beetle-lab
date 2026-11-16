import { encodeCanonicalJson, encodeJson, verifyEngineResultSeal } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import type { ConfigSchema } from '@beetle/contracts/engine-config';
import type { K6MetricShape } from '@beetle/contracts/k6-metrics';
import type { Run, RunResultSnapshot, SuiteRevision, RunComparisonRequest } from '@beetle/contracts/api';
import type { RunComparisonOptions } from '../../ports/run-comparison.js';
import { ComparisonError } from '../../ports/run-comparison.js';
import type { MetricReadOperation } from '../metric-read-lifetime/index.js';
import { captureApi } from './capture.js';
/** Read subset only after the shared closed suite schema accepts the full config. */
export interface ComparisonConfig extends K6MetricShape {
  readonly target: string;
  readonly datasets: readonly unknown[];
  readonly secrets: readonly {readonly name: string; readonly provider: string; readonly locator: string; readonly version?: string}[];
  readonly targetSampling?: object;
}
export interface Source {readonly run: Run; readonly revision: SuiteRevision; readonly result: EngineResult | null; readonly config: ComparisonConfig}
const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
function scoped(value: {id: string; scope: Run['scope']}, id: string, scope: Run['scope']): boolean {
  return same(value.id, id) && same(value.scope.organizationId, scope.organizationId) && same(value.scope.workspaceId, scope.workspaceId);
}
function checkRun(run: Run, id: string, scope: Run['scope']): void {
  if (!scoped(run, id, scope)) throw new ComparisonError('unavailable');
  if (!['finished', 'cancelled', 'errored'].includes(run.state) || run.outcome === 'pending') throw new ComparisonError('conflict');
}
function resultBinding(value: RunResultSnapshot, run: Run): EngineResult | null {
  if (!scoped(value, run.id, run.scope) || !same(value.activeAttemptId, run.activeAttemptId)) throw new ComparisonError('conflict');
  const r = value.result; if (!r) return null;
  if (!same(r.organizationId, run.scope.organizationId) || !same(r.workspaceId, run.scope.workspaceId)
    || !same(r.attemptId, run.activeAttemptId) || r.generation !== 1 || r.engineId !== run.engine.id) throw new ComparisonError('unavailable');
  return r;
}
function revisionPins(revision: SuiteRevision, run: Run): void {
  if (!scoped(revision, run.revisionId, run.scope) || !same(revision.suiteId, run.suiteId) || revision.digest !== run.revisionDigest) throw new ComparisonError('unavailable');
}
export async function loadSources(request: RunComparisonRequest, options: RunComparisonOptions, schema: ConfigSchema, owner: MetricReadOperation): Promise<Source[]> {
  const sources: Source[] = [];
  for (const id of request.runIds) {
    owner.check(); const key = {id, scope: request.scope};
    const run = captureApi('Run', await options.runs.getRun(key), 8192); owner.check(); checkRun(run, id, request.scope);
    const revision = captureApi('SuiteRevision', await options.suites.getRevision({id: run.revisionId, scope: run.scope}), 2097152); owner.check();
    revisionPins(revision, run);
    try {encodeJson(revision.config, 1048576);} catch {throw new ComparisonError('unavailable');}
    if (!schema.validate(revision.config)) throw new ComparisonError('unavailable');
    const result = resultBinding(captureApi('RunResultSnapshot', await options.results.getRunResult(key), 73728), run); owner.check();
    if (result && !verifyEngineResultSeal(result, options.digest).ok) throw new ComparisonError('unavailable');
    sources.push({run, revision, result, config: revision.config as unknown as ComparisonConfig});
  }
  return sources;
}
export async function reconcile(sources: readonly Source[], options: RunComparisonOptions, owner: MetricReadOperation): Promise<void> {
  for (const source of sources) {
    owner.check(); const current = captureApi('Run', await options.runs.getRun({id: source.run.id, scope: source.run.scope}), 8192); owner.check();
    checkRun(current, source.run.id, source.run.scope);
    if (encodeCanonicalJson(current, 8192) !== encodeCanonicalJson(source.run, 8192)) throw new ComparisonError('conflict');
    const revision = captureApi('SuiteRevision', await options.suites.getRevision({id: current.revisionId, scope: current.scope}), 2097152); owner.check();
    revisionPins(revision, current);
    if (encodeCanonicalJson(revision, 2097152) !== encodeCanonicalJson(source.revision, 2097152)) throw new ComparisonError('conflict');
    const result = resultBinding(captureApi('RunResultSnapshot', await options.results.getRunResult({id: current.id, scope: current.scope}), 73728), current); owner.check();
    if (result && !verifyEngineResultSeal(result, options.digest).ok) throw new ComparisonError('unavailable');
    if (result?.seal.sha256 !== source.result?.seal.sha256) throw new ComparisonError('conflict');
  }
}
