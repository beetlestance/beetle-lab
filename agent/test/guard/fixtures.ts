import { vi } from 'vitest';
import type { OutputGuardOptions } from '../../src/guard/types.js';
import type { OutputScanRequest, OutputScanResult } from '../../src/staging/index.js';
import { runtimeName } from '../../src/backends/docker/index.js';
import type { Operation } from '../../src/backends/docker/index.js';
import { OutputGuardService } from '../../src/guard/service.js';
import { makeInput, makePlan } from '../backends/docker/fixtures.js';

export function request(index = 1) {
  const input = { ...makeInput(), generation: index };
  const name = runtimeName({ ...input.offer, installationId: input.profile.installationId, generation: index });
  const root = `${input.profile.stagingRoot}/${name}`;
  const plan = makePlan({ ...input, staged: { input: `${root}/input`, output: `${root}/output`, secrets: `${root}/secrets` } });
  return { key: { organizationId: input.offer.organizationId, workspaceId: input.offer.workspaceId,
    attemptId: input.offer.attemptId, generation: index }, plan, outputBytes: input.offer.budget.outputBytes };
}
export const known = (startedAt = 0): OutputScanResult => ({ kind: 'known', startedAt,
  logicalBytes: 0, allocatedBytes: 0, chargedBytes: 0, freeBytes: 10000 });
export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
export const flush = async () => { for (let index = 0; index < 400; index++) await Promise.resolve(); };
export function setup(scan = vi.fn<(request: OutputScanRequest, operation: Operation) => Promise<OutputScanResult>>(
  async () => known()), extra: Partial<OutputGuardOptions> = {}) {
  const stop = vi.fn(async () => undefined);
  const service = new OutputGuardService({ root: {} as OutputGuardOptions['root'], minimumFreeBytes: 100,
    intervalMs: 50, ttlMs: 200, sampleTimeoutMs: 100, monotonicNow: () => performance.now(), stop, ...extra }, scan);
  return { service, stop, scan };
}
