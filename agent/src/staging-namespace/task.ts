import { createHash } from 'node:crypto';
import { encodeCanonicalJson, encodeJson, validatePrimitive } from '@beetle/contracts';
import { captureNativeDirectory, cleanupDigest } from '../cleanup-control/index.js';
import { namespaceCaps } from './types.js';
import type { TaskDirectoryFacts, TaskNamespaceIntent, TaskNamespaceAnchor, TaskNamespaceState, TaskNamespaceKey } from './types.js';
function assert(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid task namespace'); }
function record(input: unknown, fields: readonly string[]): Record<string, unknown> {
  const value = JSON.parse(encodeJson(input, namespaceCaps.task)) as unknown;
  assert(value && typeof value === 'object' && !Array.isArray(value)); const row = value as Record<string, unknown>;
  assert(Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field))); return row;
}
export function captureTaskNamespaceKey(input: unknown): TaskNamespaceKey {
  const row = record(input, ['attemptId', 'organizationId', 'workspaceId', 'generation']);
  for (const field of ['attemptId', 'organizationId', 'workspaceId']) assert(validatePrimitive('uuid', row[field]).ok);
  assert(row.generation === 1); return row as unknown as TaskNamespaceKey;
}
export function captureTaskNamespaceIntent(input: unknown): TaskNamespaceIntent {
  const row = record(input, ['protocolVersion', 'original', 'purpose', 'namespaceIdentity', 'specDigest', 'runtimeName']);
  assert(row.protocolVersion === 1 && (row.purpose === 'performance' || row.purpose === 'standalone_export'));
  assert(cleanupDigest(row.namespaceIdentity) && cleanupDigest(row.specDigest));
  assert(typeof row.runtimeName === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/.test(row.runtimeName));
  const original = record(row.original, ['attemptId', 'organizationId', 'workspaceId', 'generation', 'intentDigest']);
  const { intentDigest, ...key } = original; assert(cleanupDigest(intentDigest));
  return { protocolVersion: 1, original: { ...captureTaskNamespaceKey(key), intentDigest }, purpose: row.purpose,
    namespaceIdentity: row.namespaceIdentity, specDigest: row.specDigest, runtimeName: row.runtimeName };
}
export function captureTaskDirectories(input: unknown): TaskDirectoryFacts {
  const row = record(input, ['task', 'input', 'output', 'secrets']);
  const result = { task: captureNativeDirectory(row.task), input: captureNativeDirectory(row.input),
    output: captureNativeDirectory(row.output), secrets: captureNativeDirectory(row.secrets) };
  const seen = new Set<string>();
  for (const native of Object.values(result)) {
    assert(native.dev === result.task.dev && native.uid === result.task.uid && native.gid === result.task.gid && BigInt(native.mode) === 0o40700n);
    const identity = native.dev + ':' + native.ino; assert(!seen.has(identity)); seen.add(identity);
  }
  return result;
}
export function sealTaskNamespace(input: { intent: TaskNamespaceIntent; directories: TaskDirectoryFacts }): TaskNamespaceAnchor {
  const intent = captureTaskNamespaceIntent(input.intent); const directories = captureTaskDirectories(input.directories);
  const body = { protocolVersion: 1 as const, intent, directories };
  const json = encodeCanonicalJson(body, namespaceCaps.task - namespaceCaps.taskRowAllowance);
  return { ...body, taskNamespaceIdentity: createHash('sha256').update(json).digest('hex') };
}
export function captureTaskNamespaceAnchor(input: unknown, intent: TaskNamespaceIntent): TaskNamespaceAnchor {
  const row = record(input, ['protocolVersion', 'intent', 'directories', 'taskNamespaceIdentity']);
  const expected = sealTaskNamespace({ intent, directories: row.directories as TaskDirectoryFacts });
  assert(encodeCanonicalJson(row, namespaceCaps.task) === encodeCanonicalJson(expected, namespaceCaps.task)); return expected;
}
export function captureTaskNamespaceState(input: unknown): TaskNamespaceState | null {
  if (input === null) return null;
  const value = JSON.parse(encodeJson(input, namespaceCaps.task)) as TaskNamespaceState;
  const row = record(value, value?.state === 'preparing' ? ['state', 'intent'] : ['state', 'intent', 'anchor']);
  const intent = captureTaskNamespaceIntent(row.intent);
  if (row.state === 'preparing') return { state: 'preparing', intent };
  assert(row.state === 'prepared'); return { state: 'prepared', intent, anchor: captureTaskNamespaceAnchor(row.anchor, intent) };
}
