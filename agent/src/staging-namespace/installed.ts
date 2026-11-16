import { createHash } from 'node:crypto';
import { posix } from 'node:path';
import { encodeCanonicalJson, encodeJson, validatePrimitive } from '@beetle/contracts';
import { captureNativeDirectory, captureNativeFile, cleanupDigest } from '../cleanup-control/index.js';
import { namespaceCaps } from './types.js';
import type { InstalledRootFacts, NamespaceIntent, NamespaceMarker, InstalledNamespaceAnchor, InstalledNamespaceState } from './types.js';
function assert(condition: unknown): asserts condition { if (!condition) throw new Error('Invalid staging namespace'); }
function snapshot(input: unknown, fields: readonly string[], cap: number): Record<string, unknown> {
  const value = JSON.parse(encodeJson(input, cap)) as unknown;
  assert(value && typeof value === 'object' && !Array.isArray(value));
  const row = value as Record<string, unknown>;
  assert(Object.keys(row).length === fields.length && fields.every(field => Object.hasOwn(row, field))); return row;
}
function uuid(value: unknown): value is string { return validatePrimitive('uuid', value).ok && typeof value === 'string' && value === value.toLowerCase(); }
function canonicalRoot(value: unknown): value is string {
  return typeof value === 'string' && value !== '/' && value.length <= 512 && !/[\uD800-\uDFFF]/u.test(value)
    && posix.isAbsolute(value) && posix.normalize(value) === value
    && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127);
}
export function captureInstalledRoot(input: unknown): InstalledRootFacts {
  const row = snapshot(input, ['protocolVersion', 'installationId', 'daemonId', 'source', 'target', 'native'], namespaceCaps.root);
  assert(row.protocolVersion === 1 && uuid(row.installationId));
  assert(typeof row.daemonId === 'string' && /^[A-Za-z0-9:._-]{1,128}$/.test(row.daemonId));
  assert(canonicalRoot(row.source) && row.source === row.target);
  const native = captureNativeDirectory(row.native); assert((BigInt(native.mode) & 0o022n) === 0n);
  return { protocolVersion: 1, installationId: row.installationId, daemonId: row.daemonId,
    source: row.source, target: row.source, native };
}
export function installedRootDigest(root: InstalledRootFacts): string {
  return createHash('sha256').update(encodeCanonicalJson(captureInstalledRoot(root), namespaceCaps.root)).digest('hex');
}
export function captureNamespaceIntent(input: unknown): NamespaceIntent {
  const row = snapshot(input, ['protocolVersion', 'namespaceId', 'journalAuthority', 'root', 'rootDigest', 'nonce'], namespaceCaps.intent);
  assert(row.protocolVersion === 1 && uuid(row.namespaceId) && uuid(row.journalAuthority) && cleanupDigest(row.nonce));
  const root = captureInstalledRoot(row.root); assert(row.rootDigest === installedRootDigest(root));
  return { protocolVersion: 1, namespaceId: row.namespaceId, journalAuthority: row.journalAuthority,
    root, rootDigest: row.rootDigest as string, nonce: row.nonce };
}
export function namespaceMarkerBytes(input: NamespaceIntent): Uint8Array {
  const intent = captureNamespaceIntent(input);
  return new TextEncoder().encode(encodeCanonicalJson({ protocolVersion: 1, namespaceId: intent.namespaceId,
    journalAuthority: intent.journalAuthority, installationId: intent.root.installationId,
    rootDigest: intent.rootDigest, nonce: intent.nonce }, namespaceCaps.marker));
}
export function captureNamespaceMarker(input: unknown, intent: NamespaceIntent): NamespaceMarker {
  const row = snapshot(input, ['dev', 'ino', 'uid', 'gid', 'mode', 'bytes', 'links', 'sha256'], 1024);
  const { sha256, ...value } = row; const native = captureNativeFile(value);
  const bytes = namespaceMarkerBytes(intent); const root = intent.root.native;
  assert(native.dev === root.dev && native.uid === root.uid && native.gid === root.gid
    && BigInt(native.mode) === 0o100400n && native.bytes === String(bytes.byteLength));
  assert(sha256 === createHash('sha256').update(bytes).digest('hex'));
  return { ...native, sha256: sha256 as string };
}
export function sealNamespaceAnchor(input: { intent: NamespaceIntent; marker: NamespaceMarker }): InstalledNamespaceAnchor {
  const intent = captureNamespaceIntent(input.intent); const marker = captureNamespaceMarker(input.marker, intent);
  const body = { protocolVersion: 1 as const, namespaceId: intent.namespaceId, journalAuthority: intent.journalAuthority,
    rootDigest: intent.rootDigest, marker };
  const namespaceIdentity = createHash('sha256').update(encodeCanonicalJson(body, namespaceCaps.anchor)).digest('hex');
  return { protocolVersion: 1, namespaceId: intent.namespaceId, rootDigest: intent.rootDigest, marker, namespaceIdentity };
}
export function captureNamespaceAnchor(input: unknown, intent: NamespaceIntent): InstalledNamespaceAnchor {
  const row = snapshot(input, ['protocolVersion', 'namespaceId', 'rootDigest', 'marker', 'namespaceIdentity'], namespaceCaps.anchor);
  const expected = sealNamespaceAnchor({ intent, marker: row.marker as NamespaceMarker });
  assert(encodeCanonicalJson(row, namespaceCaps.anchor) === encodeCanonicalJson(expected, namespaceCaps.anchor)); return expected;
}
export function captureNamespaceState(input: unknown): InstalledNamespaceState | null {
  if (input === null) return null;
  const captured = JSON.parse(encodeJson(input, namespaceCaps.state)) as InstalledNamespaceState;
  const fields = captured?.state === 'preparing' ? ['state', 'intent'] : ['state', 'intent', 'anchor'];
  const row = snapshot(captured, fields, namespaceCaps.state); const intent = captureNamespaceIntent(row.intent);
  if (row.state === 'preparing') return { state: 'preparing', intent };
  assert(row.state === 'bound'); return { state: 'bound', intent, anchor: captureNamespaceAnchor(row.anchor, intent) };
}
