import { vi } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import type { LiveMetricSnapshot } from '@beetle/contracts/api';
import data from '../../../../../contracts/fixtures/api/valid/live-metric-snapshot.json' with {type: 'json'};
import { LiveMetricReads } from './read.js';
import type { LiveFrame, LiveReadPorts } from './read.js';
const checked = validateApi('LiveMetricSnapshot', data); if (!checked.ok) throw new Error('Invalid shared synthetic frame');
const template = checked.value;
export function frame(patch: Partial<LiveMetricSnapshot> = {}): LiveMetricSnapshot {return {...structuredClone(template), ...patch};}
export function deferred<T>() {let resolve!: (value: T) => void; const promise = new Promise<T>(pass => {resolve = pass;}); return {promise, resolve};}
export async function digest(bytes: Uint8Array): Promise<string> {
  const value = await globalThis.crypto.subtle.digest('SHA-256', Uint8Array.from(bytes));
  return Array.from(new Uint8Array(value), byte => byte.toString(16).padStart(2, '0')).join('');
}
export function latest(value = frame(), mono = 0, wall = 1000): LiveFrame {
  return {frame: value, fingerprint: 'a'.repeat(64), receivedWall: wall, receivedMono: mono, expiresAtMono: mono + 6000};
}
export function fixture(patch: Partial<LiveReadPorts> = {}) {
  let wall = 1000; let mono = 0; let value = frame();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(JSON.stringify(value), {headers: {'content-type': 'application/json'}}));
  const hash = vi.fn(digest); const controller = new AbortController();
  const params = {organizationId: value.scope.organizationId, workspaceId: value.scope.workspaceId,
    runId: '00000000-0000-4000-8000-000000000005', attemptId: value.scope.attemptId};
  const reads = new LiveMetricReads({fetch, digest: hash, wall: () => wall, monotonic: () => mono, ...patch});
  return {reads, fetch, digest: hash, controller, params, input: {params, signal: controller.signal},
    value: () => value, set(next: LiveMetricSnapshot) {value = next;}, clock(nextWall: number, nextMono = mono) {wall = nextWall; mono = nextMono;}};
}
