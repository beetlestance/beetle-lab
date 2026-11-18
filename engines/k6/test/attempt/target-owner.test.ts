import { mkdtemp, realpath, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { AttemptTarget } from '../../wrapper/attempt/target.js';
import { TargetArchive } from '../../wrapper/target-archive/index.js';
import { deferred, liveInput } from './live-fixtures.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); vi.useRealTimers(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it('holds an in-flight observation behind the initial snapshot without duplicate samples or concurrent appends', async () => {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'beetle-attempt-target-'));
  cleanups.push(() => rm(directory, { recursive: true, force: true }));
  vi.useFakeTimers();
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response('{"rss":10}'));
  const base = liveInput(); const owner = new AttemptTarget(); cleanups.push(() => owner.close());
  await owner.start({ suite: { ...base.suite, targetSampling: { path: '/metrics', intervalMs: 1000, timeoutMs: 100, cooldownMs: 0 } },
    directory, uid: process.getuid!(), scope: base.scope, allowance: 1048576, signal: base.signal, wall: Date.now, check: () => {} });
  const create = TargetArchive.create; const gate = deferred(); const entered = deferred();
  vi.spyOn(TargetArchive, 'create').mockImplementation(async options => { entered.resolve(); await gate.promise; return create(options); });
  const recording = owner.startRecording(); expect(owner.startRecording()).toBe(recording);
  await entered.promise; await vi.advanceTimersByTimeAsync(1000);
  expect(owner.source!.recent(256)).toHaveLength(1);
  gate.resolve(); await recording; await owner.finish();
  const records = (await readFile(join(directory, 'target-samples.ndjson'), 'utf8')).trimEnd().split('\n').map(line => JSON.parse(line));
  expect(owner.report!.samples).toHaveLength(2);
  expect(records.slice(1).map(record => record.sample)).toEqual(owner.report!.samples);
  expect(owner.completedPrefix()).toBeUndefined(); expect(vi.getTimerCount()).toBe(0);
});
