import { ComparisonError } from '../../ports/run-comparison.js';
import { encodeCanonicalJson, encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { RunComparisonConfigChange, SuiteRevision } from '@beetle/contracts/api';
interface Pair {readonly left: unknown; readonly right: unknown; readonly path: string; readonly depth: number}
const object = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object';
function pointer(parent: string, key: string): string {return `${parent}/${key.replaceAll('~', '~0').replaceAll('/', '~1')}`;}
function representable(path: string): boolean {try {encodeJson(path, 512); return validateApi('RunComparisonConfigChange', {path, change: 'changed'}).ok;} catch {return false;}}
function children(pair: Pair): Pair[] | 'limited' | null {
  if (!object(pair.left) || !object(pair.right) || Array.isArray(pair.left) !== Array.isArray(pair.right)) return null;
  const keys = [...new Set([...Object.keys(pair.left), ...Object.keys(pair.right)])];
  if (keys.length > 4096) return 'limited';
  keys.sort();
  return keys.map(key => ({left: Object.hasOwn(pair.left as object, key) ? (pair.left as Record<string, unknown>)[key] : undefined,
    right: Object.hasOwn(pair.right as object, key) ? (pair.right as Record<string, unknown>)[key] : undefined,
    path: pointer(pair.path, key), depth: pair.depth + 1}));
}
function change(pair: Pair): RunComparisonConfigChange {
  return {path: pair.path, change: pair.left === undefined ? 'added' : pair.right === undefined ? 'removed' : 'changed'};
}
/** Bounded pointer-only traversal of captured JSON values; never returns configuration content. */
export function configDifferences(left: unknown, right: unknown) {
  const pending: Pair[] = [{left, right, path: '', depth: 0}]; const configChanges: RunComparisonConfigChange[] = [];
  for (let nodes = 0; pending.length; nodes++) {
    if (nodes >= 65536) return {configChanges: [{path: '', change: 'changed' as const}], limited: true};
    const pair = pending.pop()!; if (Object.is(pair.left, pair.right)) continue;
    if (pair.depth > 64 || !representable(pair.path)) return {configChanges: [{path: '', change: 'changed' as const}], limited: true};
    const next = children(pair);
    if (next === 'limited') return {configChanges: [{path: '', change: 'changed' as const}], limited: true};
    if (Array.isArray(next)) {
      // Bound pending pairs independently of the visited-node allowance.
      if (pending.length + next.length > 4096) return {configChanges: [{path: '', change: 'changed' as const}], limited: true};
      pending.push(...next.reverse()); continue;
    }
    if (configChanges.length === 100) return {configChanges, limited: true};
    configChanges.push(change(pair));
  }
  return {configChanges, limited: false};
}

/** Equal pinned digests avoid traversal; contradictory captured content still fails closed. */
export function revisionDifferences(baseline: SuiteRevision, peer: SuiteRevision) {
  if (baseline.digest !== peer.digest) return configDifferences(baseline.config, peer.config);
  const content = (value: SuiteRevision) => encodeCanonicalJson({config: value.config, inputManifest: value.inputManifest}, 2097152);
  if (content(baseline) !== content(peer)) throw new ComparisonError('unavailable');
  return {configChanges: [], limited: false};
}
