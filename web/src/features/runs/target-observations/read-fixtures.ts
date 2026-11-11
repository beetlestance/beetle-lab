import source from '../../../../../contracts/fixtures/valid/target-runtime-report.json' with {type: 'json'};
import { vi } from 'vitest';
import { TargetReportReads } from './read.js';
import type { TargetReadPorts } from './read.js';
import { captureTargetRuntimeReport } from '@beetle/contracts/target-runtime';
export function report() {return captureTargetRuntimeReport(source);}
/** Fixed SHA256 vectors, independently exercised through the native digest port. */
export function hash(bytes: Uint8Array): string {
  const text = new TextDecoder().decode(bytes);
  if (text === JSON.stringify(report())) return '283c895225767bd56ff7c67fa5395d0405c31472c0ced935681656d3c33c9a31';
  if (text === '{"version":2}') return '732322c128ed67841ef5aa42c7cd04ffcd74a61b2d17d710cd502b713d62930d';
  throw new Error('Unexpected digest fixture');
}
export function deferred<T>() {
  let resolve!: (value: T) => void; const promise = new Promise<T>(pass => {resolve = pass;}); return {promise, resolve};
}
export function fixture(patch: Partial<TargetReadPorts> = {}) {
  const bytes = new TextEncoder().encode(JSON.stringify(report()));
  const params = {organizationId: '00000000-0000-4000-8000-000000000001', workspaceId: '00000000-0000-4000-8000-000000000002',
    runId: '00000000-0000-4000-8000-000000000003', attemptId: '00000000-0000-4000-8000-000000000004', artifactId: '00000000-0000-4000-8000-000000000005'};
  const artifact = {artifactId: params.artifactId, kind: 'target-runtime', relativePath: 'target-runtime.json',
    bytes: bytes.length, sha256: hash(bytes), sealedAt: '2026-01-01T00:00:00.000Z'};
  const controller = new AbortController();
  const fetch = vi.fn<typeof globalThis.fetch>(async () => new Response(bytes, {status: 200, headers: {'content-length': String(bytes.length)}}));
  const digest = vi.fn(async (body: Uint8Array) => hash(body));
  const reads = new TargetReportReads({fetch, digest, monotonic: () => 0, ...patch});
  return {reads, bytes, params, artifact, controller, fetch, digest,
    input: {params, artifact, signal: controller.signal}};
}
