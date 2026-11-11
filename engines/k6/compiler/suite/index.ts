import { compileLoadPlan } from '../index.js';
import { metricLayout } from '../../plan/index.js';
import { freezeSchema } from '../schema-freeze.js';
import type { ValidatedLoadPlan } from '../types.js';
import { compileDatasets } from './datasets.js';
import { boundary, fail } from './failure.js';
import { canonical, checkedDigest } from './identity.js';
import { loadInputs } from './inputs.js';
import { unsafeNames } from './limits.js';
import { compileReadiness } from './readiness.js';
import { compileRequests } from './requests.js';
import { compileSelections } from './selection.js';
import { compileTarget, safeRelativePath } from './target.js';
import type { CompiledSuite, CompileOptions, DeepReadonly, Result, ValidatedSuiteConfig } from './types.js';
export type * from './types.js';
export { initialSelectionState, selectDatasetRows, selectRequest } from './selection.js';
export type { Random, SelectionResult, SelectionState } from './selection.js';
function unique(items: readonly { readonly id: string }[]): void {
  const seen = new Set<string>();
  for (const item of items) {
    if (seen.has(item.id) || unsafeNames.has(item.id)) fail('duplicate_id');
    seen.add(item.id);
  }
}
function validateNames(config: ValidatedSuiteConfig): void {
  unique(config.requests); unique(config.datasets);
  const names = new Set<string>();
  for (const secret of config.secrets) {
    if (names.has(secret.name) || unsafeNames.has(secret.name)) fail('duplicate_name', '/secrets');
    names.add(secret.name);
  }
  if (new Set(config.requests.map(request => request.name)).size !== config.requests.length) fail('duplicate_name', '/requests');
}
/** Pure compiler. digest must be trusted SHA-256; all input content is immutable and integrity checked. */
export function compileSuite(config: ValidatedSuiteConfig, options: CompileOptions): Result<DeepReadonly<CompiledSuite>> {
  const loadPlan = compileLoadPlan(config.loadPlan as ValidatedLoadPlan);
  if (!loadPlan.ok) return loadPlan;
  return boundary(() => {
    validateNames(config);
    const loaded = loadInputs(config, options.input, options.digest);
    const expansion = { bytes: 0, bodyNodes: 0 };
    const datasets = compileDatasets(config.datasets, loaded.content, expansion);
    const scope = { datasets, secrets: config.secrets };
    const target = compileTarget(options.input.targetOverride ?? config.target);
    // Validate the stored target even when an explicit override takes precedence.
    compileTarget(config.target);
    const result: CompiledSuite = { component: 'k6-suite', compilerVersion: '1.0', schemaVersion: 1,
      loadPlan: loadPlan.value, target, datasets, requests: compileRequests(config, loaded.content, scope, expansion),
      selections: compileSelections(config), identity: {
        digest: '', engine: { ...options.input.engine }, inputs: loaded.refs.map(ref => ({ ...ref })),
        secrets: config.secrets.map(secret => ({ ...secret })),
        reproducibility: config.secrets.some(secret => !secret.version) ? 'unknown' : 'pinned',
      } };
    const readiness = compileReadiness(config, scope);
    if (readiness) result.readiness = readiness;
    if (config.targetSampling) {
      const sampling = config.targetSampling;
      if (!safeRelativePath(sampling.path) || sampling.timeoutMs > sampling.intervalMs) fail('target', '/targetSampling');
      result.targetSampling = { ...sampling };
    }
    metricLayout(result);
    result.identity.digest = checkedDigest(options.digest, canonical({ compilerVersion: result.compilerVersion,
      schemaVersion: result.schemaVersion, config, target, engine: options.input.engine, inputs: loaded.refs }));
    return freezeSchema(result);
  });
}
