import type { InputRecord } from '../generated/types.js';

export const emptyHash = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';
export function record(overrides: Partial<InputRecord> = {}): InputRecord {
  return { id: '00000000-0000-4000-8000-000000000001', scope: { kind: 'workspace',
    organizationId: '00000000-0000-4000-8000-000000000002', workspaceId: '00000000-0000-4000-8000-000000000003' },
  folderId: '00000000-0000-4000-8000-000000000004', name: 'fixture', sha256: emptyHash,
  bytes: 0, offset: 0, version: 1, state: 'published', reason: null, ...overrides };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function binary(body: Uint8Array, hash = emptyHash, headers: Record<string, string> = {}): Response {
  return new Response(body, { headers: { 'content-type': 'application/octet-stream', etag: `"${hash}"`, ...headers } });
}
export function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
}
export async function turns(): Promise<void> { for (let i = 0; i < 12; i++) await Promise.resolve(); }
export async function sha256(body: Uint8Array): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', body);
  return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
}
