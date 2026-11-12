import { encodeCanonicalJson } from '@beetle/contracts';
import type { ResultDigest } from '@beetle/contracts';
import type { RunComparisonEnvironment, RunComparisonResult } from '@beetle/contracts/api';
import type { Source } from './source.js';
import { ComparisonError } from '../../ports/run-comparison.js';
function fingerprint(value: unknown, purpose: 'target' | 'inputs' | 'secret-bindings', digest: ResultDigest): string {
  const hash = digest(`beetle-lab.comparison.${purpose}.v1\n` + encodeCanonicalJson(value, purpose === 'inputs' ? 2097152 : 131072));
  if (!/^[a-f0-9]{64}$/.test(hash)) throw new ComparisonError('unavailable'); return hash;
}
const lexical = (a: string, b: string): number => a < b ? -1 : a > b ? 1 : 0;
export function environment(source: Source, digest: ResultDigest): RunComparisonEnvironment {
  const inputs = source.revision.inputManifest.map(item => ({...item, id: item.id.toLowerCase()})).sort((a, b) => lexical(a.id, b.id));
  const secrets = [...source.config.secrets].sort((a, b) => lexical(a.name, b.name));
  return {targetDigest: fingerprint(source.config.target, 'target', digest), inputsDigest: fingerprint({manifest: inputs, datasets: source.config.datasets}, 'inputs', digest),
    secretBindingsDigest: fingerprint(secrets, 'secret-bindings', digest), secretVersions: secrets.some(secret => secret.version === undefined) ? 'unknown' : 'known',
    targetSampler: source.config.targetSampling === undefined ? 'disabled' : 'configured', targetRevision: 'unknown', contention: 'unknown'};
}
export function summary(source: Source): RunComparisonResult | null {
  const r = source.result; if (!r) return null;
  return {outcome: r.outcome, completeness: r.completeness, execution: r.execution, requiredAssertions: r.requiredAssertions,
    failedSloCount: r.thresholds.filter(rule => rule.purpose === 'slo' && !rule.passed).length,
    discoveryReached: r.mode === 'discovery' ? r.expectedAbort.reached : null};
}
