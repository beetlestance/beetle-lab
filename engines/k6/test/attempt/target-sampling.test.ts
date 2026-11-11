import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { fixture, native, resetNative } from './fixtures.js';
import { reserveOutput, phaseReservation } from '../../wrapper/attempt/reservation.js';
import type { SuiteConfig } from '../../compiler/suite/index.js';
const cleanups: (() => Promise<void>)[] = [];
beforeEach(resetNative);
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanups.splice(0).map(clean => clean())); });
async function setup() {
  const f = await fixture();cleanups.push(f.cleanup);
  (f.offer.config as SuiteConfig).targetSampling = { path: '/stats', intervalMs: 1000, timeoutMs: 100, cooldownMs: 0 };
  await f.save();return f;
}
it('publishes target observations as a separately scoped, hash-bound artifact under admitted output', async () => {
  const fetch = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({ rss: 1234, cpuPercent: 5 })));
  const f = await setup();const result = await f.run();expect(result.ok).toBe(true);expect(native.calls).toBe(1);
  const artifact = result.result!.artifacts.find(a => a.kind === 'target-runtime');expect(artifact).toBeDefined();
  const bytes = await readFile(join(f.outputRoot, artifact!.relativePath));expect(bytes.length).toBe(artifact!.bytes);
  expect(createHash('sha256').update(bytes).digest('hex')).toBe(artifact!.sha256);
  const report = JSON.parse(bytes.toString()) as {scope: string; samples: {phase: string; values: {rss: number; heapAlloc: null}}[]};
  expect(report.scope).toBe('target-reported');expect(report.samples[0]).toMatchObject({ phase: 'before', values: { rss: 1234, heapAlloc: null } });
  expect(fetch).toHaveBeenCalledWith(new URL('https://example.invalid/api/stats'), expect.objectContaining({ credentials: 'omit', redirect: 'error' }));
  const published = JSON.parse(await readFile(join(f.outputRoot, 'engine-result.json'), 'utf8')) as {artifacts: unknown[]};
  expect(published.artifacts).toContainEqual(artifact);expect((await lstat(join(f.outputRoot, artifact!.relativePath))).mode & 0o777).toBe(0o600);
});
it('keeps target HTTP failures advisory without fabricating sensor values', async () => {
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('private body', { status: 503 }));
  const f = await setup();const result = await f.run();expect(result.ok).toBe(true);
  const artifact = result.result!.artifacts.find(a => a.kind === 'target-runtime')!;
  const text = await readFile(join(f.outputRoot, artifact.relativePath), 'utf8');
  expect(text).toContain('"status":"unavailable"');expect(text).toContain('"rss":null');expect(text).not.toContain('private body');
});
it('reserves target bytes from existing partitions and rejects insufficient collection space', async () => {
  const f = await setup();const total = f.offer.budget.outputBytes;const plain = reserveOutput(total);const sampled = reserveOutput(total, true);
  expect(sampled.target).toBe(1048576);expect(plain.target).toBe(0);
  expect(sampled.control + sampled.numeric + sampled.result + sampled.execution + sampled.target).toBeLessThanOrEqual(total);
  expect(sampled.build).toBeLessThan(plain.build);
  expect(phaseReservation(sampled, f.manifest).historyCollect).toBe(1048576);
  f.manifest.phases.find(phase => phase.phase === 'collect')!.outputBytes = 3 * 1048576;
  expect(() => phaseReservation(sampled, f.manifest)).toThrow('output_limit');
});
