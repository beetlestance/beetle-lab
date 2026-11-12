import { createHash } from 'node:crypto';
import { encodeCanonicalJson, encodeJson, validatePrimitive } from '@beetle/contracts';
import { cleanupControl } from './limits.js';
import { captureNativeDirectory, captureNativeFile } from './facts.js';
import type { NativeDirectoryFact, NativeFileFact } from './facts.js';
export interface CleanupOriginal {
  readonly organizationId: string; readonly workspaceId: string; readonly attemptId: string;
  readonly generation: 1; readonly intentDigest: string;
}
export type CleanupEntry = { readonly path: string; readonly kind: 'directory'; readonly native: NativeDirectoryFact }
  | { readonly path: string; readonly kind: 'file'; readonly native: NativeFileFact };
export interface NativeCleanupPlan {
  readonly protocolVersion: 1; readonly purpose: 'performance'; readonly original: CleanupOriginal;
  readonly namespaceIdentity: string; readonly taskNamespaceIdentity: string;
  readonly retirementRequestDigest: string; readonly retirementVersion: 1;
  readonly entries: readonly CleanupEntry[];
}
function assert(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid cleanup plan'); }
function closed(value: unknown, fields: readonly string[]): Record<string, unknown> {
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  assert(Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field))); return row;
}
export function cleanupDigest(value: unknown): value is string { return typeof value === 'string' && /^[a-f0-9]{64}$/.test(value); }
function original(value: unknown): CleanupOriginal {
  const row = closed(value, ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest']);
  for (const key of ['organizationId', 'workspaceId', 'attemptId']) {
    assert(validatePrimitive('uuid', row[key]).ok);
  }
  assert(row.generation === 1 && cleanupDigest(row.intentDigest)); return row as unknown as CleanupOriginal;
}
function path(value: unknown): string {
  assert(typeof value === 'string' && value.length <= cleanupControl.maximumPathBytes && !/[\uD800-\uDFFF]/u.test(value));
  assert(new TextEncoder().encode(value).length <= cleanupControl.maximumPathBytes);
  assert(![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 || char === '\\'));
  if (value === '') return value;
  const parts = value.split('/');
  assert(parts.length <= cleanupControl.maximumDepth && parts.every(part => part !== '' && part !== '.' && part !== '..'));
  return value;
}
function entries(value: unknown): CleanupEntry[] {
  assert(Array.isArray(value) && value.length >= 1 && value.length <= cleanupControl.maximumEntries);
  const directories = new Set<string>(); let previous: string | null = null;
  const result: CleanupEntry[] = value.map((input: unknown, index: number) => {
    const row = closed(input, ['path', 'kind', 'native']); const name = path(row.path);
    assert(index === 0 ? name === '' && row.kind === 'directory' : previous !== null && name > previous);
    if (index !== 0) assert(directories.has(name.slice(0, Math.max(0, name.lastIndexOf('/')))));
    previous = name;
    if (row.kind === 'directory') {
      directories.add(name); return { path: name, kind: 'directory', native: captureNativeDirectory(row.native) };
    }
    assert(row.kind === 'file'); return { path: name, kind: 'file', native: captureNativeFile(row.native) };
  });
  ownedEntries(result); return result;
}
function ownedEntries(rows: readonly CleanupEntry[]): void {
  const root = rows[0]!.native; const seen = new Set<string>();
  for (const { native } of rows) {
    assert(native.dev === root.dev && native.uid === root.uid && native.gid === root.gid);
    const key = native.dev + ':' + native.ino; assert(!seen.has(key)); seen.add(key);
  }
}
/** Validates a bounded description. This is not native custody or permission to unlink. */
export function captureNativeCleanupPlan(input: unknown): NativeCleanupPlan {
  const row = closed(JSON.parse(encodeJson(input, cleanupControl.planBytes)) as unknown,
    ['protocolVersion', 'purpose', 'original', 'namespaceIdentity', 'taskNamespaceIdentity', 'retirementRequestDigest', 'retirementVersion', 'entries']);
  assert(row.protocolVersion === 1 && row.purpose === 'performance' && row.retirementVersion === 1);
  for (const field of ['namespaceIdentity', 'taskNamespaceIdentity', 'retirementRequestDigest']) assert(cleanupDigest(row[field]));
  return { protocolVersion: 1, purpose: 'performance', original: original(row.original),
    namespaceIdentity: row.namespaceIdentity as string, taskNamespaceIdentity: row.taskNamespaceIdentity as string,
    retirementRequestDigest: row.retirementRequestDigest as string, retirementVersion: 1, entries: entries(row.entries) };
}
export function nativeCleanupPlanIdentity(input: NativeCleanupPlan): string {
  return createHash('sha256').update(encodeCanonicalJson(captureNativeCleanupPlan(input), cleanupControl.planBytes)).digest('hex');
}
