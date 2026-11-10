import { afterEach, vi } from 'vitest';
import { createScheduler } from '../../src/scheduler/index.js';
import type { Scheduler, SchedulerOptions } from '../../src/scheduler/index.js';
import type { GenerationKey, RunnablePage, RunnableRequest } from '../../src/journal/index.js';
import type { DriveProgress } from '../../src/installation/index.js';

export function key(id: number): GenerationKey {
  return { organizationId: '00000000-0000-4000-8000-000000000001',
    workspaceId: '00000000-0000-4000-8000-000000000002',
    attemptId: `00000000-0000-4000-8000-${id.toString().padStart(12, '0')}`, generation: 1 };
}
export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
export const released: DriveProgress = { kind: 'released', collection: 'finished' };
const loops: Scheduler[] = [];
export const releases: (() => void)[] = [];
export function empty(page: RunnableRequest): RunnablePage {
  return page.lane === 'delivery' ? { attempts: [], through: page.through ?? 0 } : { attempts: [] };
}
export function fixture(overrides: Partial<SchedulerOptions> = {}) {
  vi.useFakeTimers();
  const scanRunnable = vi.fn<SchedulerOptions['journal']['scanRunnable']>().mockImplementation(async page => empty(page));
  const drive = vi.fn<SchedulerOptions['installation']['drive']>().mockResolvedValue(released);
  const loop = createScheduler({ journal: { scanRunnable }, installation: { drive },
    intervalMs: 50, operationTimeoutMs: 100, monotonicNow: () => 1000, ...overrides });
  loops.push(loop);
  return { loop, scanRunnable, drive };
}
afterEach(async () => {
  for (const release of releases.splice(0)) release();
  await Promise.all(loops.splice(0).map(loop => loop.close()));
  vi.useRealTimers();
});
