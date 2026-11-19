import { createHash } from 'node:crypto';
import { mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import {
  createK6LiveApproval,
  decodeK6HistoryCheckpoint,
  K6_HISTORY_CHECKPOINT_NAMES,
} from '@beetle/contracts/k6-live';
import type { LiveMetricArchivePrefix } from '@beetle/contracts/api';
import { CHECKPOINT_ALLOWANCE, HistoryCheckpoint } from '../../wrapper/attempt/history-checkpoint.js';
import { AppendFiles } from '../../wrapper/artifact-custody/index.js';
import { deferred, liveInput } from './live-fixtures.js';

const roots: string[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});
const hash = (value: string) => createHash('sha256').update(value).digest('hex');

async function setup() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-history-checkpoint-')));
  roots.push(root);
  const { assignment, scope, suite } = liveInput();
  const approval = createK6LiveApproval({ assignment, scope, source: suite, hash });
  const signal = new AbortController();
  const sync = vi.fn(async () => {});
  let now = 0;
  const owner = new HistoryCheckpoint({
    root,
    uid: process.getuid!(),
    approval,
    signal: signal.signal,
    sync,
    monotonic: () => now,
  });
  const slot = (index: 0 | 1) => join(root, K6_HISTORY_CHECKPOINT_NAMES[index]);
  const capture = async (index: 0 | 1) => decodeK6HistoryCheckpoint(await readFile(slot(index)), approval, hash);
  const prefix = (windows: number): LiveMetricArchivePrefix => ({
    scope,
    windows,
    endTimeMs: windows * 1000,
    data: {
      artifactId: '00000000-0000-4000-8000-000000000004',
      relativePath: 'metric-windows.ndjson',
      bytes: 512,
      sha256: hash('data'),
    },
    index: {
      artifactId: '00000000-0000-4000-8000-000000000005',
      relativePath: 'metric-index.ndjson',
      bytes: 128,
      sha256: hash('index'),
    },
  });
  return {
    owner,
    slot,
    capture,
    prefix,
    sync,
    signal,
    time: (value: number) => {
      now = value;
    },
  };
}

it('alternates fixed slots, advances on cadence and reserves both maximum extents once', async () => {
  const f = await setup();
  try {
    await f.owner.publish(f.prefix(1));
    expect(await f.capture(0)).toEqual(f.prefix(1));
    expect(f.owner.chargedBytes).toBe(CHECKPOINT_ALLOWANCE);
    f.time(4999);
    await f.owner.publish(f.prefix(2));
    expect(await f.capture(1)).toBeUndefined();
    f.time(5000);
    await f.owner.publish(f.prefix(6));
    f.time(10000);
    await f.owner.publish(f.prefix(11));
    expect(await f.capture(0)).toEqual(f.prefix(11));
    expect(await f.capture(1)).toEqual(f.prefix(6));
    expect(f.sync).toHaveBeenCalledTimes(3);
    expect(f.owner.chargedBytes).toBe(CHECKPOINT_ALLOWANCE);
  } finally {
    await f.owner.close();
  }
});

it('preserves the last valid slot through a stop during the next write', async () => {
  const f = await setup();
  try {
    await f.owner.publish(f.prefix(1));
    f.time(5000);
    vi.spyOn(AppendFiles.prototype, 'replaceCheckpoint').mockImplementationOnce(async (_lane, bytes) => {
      await writeFile(f.slot(1), bytes.subarray(0, bytes.length - 15));
      f.signal.abort();
      throw new Error('interrupted');
    });
    await f.owner.publish(f.prefix(6));
    expect(await f.capture(0)).toEqual(f.prefix(1));
    expect(await f.capture(1)).toBeUndefined();
  } finally {
    await f.owner.close();
  }
});

it('waits for the issued sync and fences its unissued write on close', async () => {
  const f = await setup();
  await f.owner.publish(f.prefix(1));
  f.time(5000);
  const entered = deferred();
  const release = deferred();
  f.sync.mockImplementationOnce(async () => {
    entered.resolve();
    await release.promise;
  });
  const writing = f.owner.publish(f.prefix(6));
  await entered.promise;
  const closing = f.owner.close();
  expect(f.owner.close()).toBe(closing);
  release.resolve();
  await writing;
  await closing;
  f.time(5000);
  await f.owner.publish(f.prefix(6));
  expect(await f.capture(0)).toEqual(f.prefix(1));
  expect(await f.capture(1)).toBeUndefined();
});
