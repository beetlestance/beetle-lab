import { appendFile, lstat, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { encodeK6HistoryCheckpoint, K6_HISTORY_CHECKPOINT_NAMES } from '@beetle/contracts/k6-live';
import type { K6LiveApproval } from '@beetle/contracts/k6-live';
import type { LiveMetricArchivePrefix } from '@beetle/contracts/api';
import { readStoppedHistory } from '../../src/collection/live-history/index.js';
import { snapshotRootIdentity } from '../../src/collection/root/index.js';
import { historyFixture, sha } from './fixtures.js';
import { targetFixture } from './target-fixtures.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

async function fixture(withTarget = false) {
  const f = await historyFixture(cleanups);
  const target = withTarget ? await targetFixture(f) : undefined;
  const { frame, uid } = f.options;
  const approval: K6LiveApproval = {
    scope: frame.scope,
    producerEpoch: frame.producerEpoch,
    subset: frame.subset,
    targetIntervalMs: target?.prefix.intervalMs ?? null,
  };
  const slot = (lane: 0 | 1) => join(f.directory, K6_HISTORY_CHECKPOINT_NAMES[lane]);
  const put = (lane: 0 | 1, prefix = f.prefix) =>
    writeFile(slot(lane), encodeK6HistoryCheckpoint(prefix, approval, sha), { mode: 0o600 });
  const root = async () => snapshotRootIdentity(f.directory, uid, await lstat(f.directory, { bigint: true }));
  const start = async (overrides: Partial<Parameters<typeof readStoppedHistory>[0]> = {}) => {
    const operation = readStoppedHistory({
      root: await root(),
      approval,
      maximumBytes: 8_000_000,
      deadline: performance.now() + 10000,
      ...overrides,
    });
    cleanups.push(async () => {
      await operation.quiesced;
      await operation.close();
    });
    return operation;
  };
  return { ...f, approval, slot, put, start, root, target };
}

it('verifies the metric and target prefixes while ignoring interrupted append tails', async () => {
  const f = await fixture(true);
  await f.put(0);
  await appendFile(join(f.directory, f.prefix.data.relativePath), 'unfinished metric');
  await appendFile(join(f.directory, f.prefix.index.relativePath), 'unfinished index');
  await appendFile(f.target!.path, 'unfinished target');
  const result = await (await f.start()).result;
  expect(result).toMatchObject({
    ok: true,
    value: { prefix: f.prefix, samples: [{ sequence: 1 }, { sequence: 2 }, { sequence: 3 }] },
  });
  if (result.ok) expect(result.value.targetSamples).toEqual(f.target!.samples);
});

it('falls back to the earlier slot when the later write is torn', async () => {
  const f = await fixture();
  await f.put(0);
  const good = await readFile(f.slot(0));
  await writeFile(f.slot(1), good.subarray(0, good.length - 12), { mode: 0o600 });
  expect(await (await f.start()).result).toMatchObject({ ok: true, value: { prefix: f.prefix } });
});

it('uses the latest valid extent even if the slot with fewer windows is second', async () => {
  const f = await fixture();
  const data = await readFile(join(f.directory, f.prefix.data.relativePath), 'utf8');
  const index = await readFile(join(f.directory, f.prefix.index.relativePath), 'utf8');
  const firstRow = (source: string) => source.split('\n').slice(0, 2).join('\n') + '\n';
  const firstData = firstRow(data);
  const firstIndex = firstRow(index);
  const earlier: LiveMetricArchivePrefix = {
    ...f.prefix,
    windows: 1,
    endTimeMs: 1000,
    data: { ...f.prefix.data, bytes: Buffer.byteLength(firstData), sha256: sha(firstData) },
    index: { ...f.prefix.index, bytes: Buffer.byteLength(firstIndex), sha256: sha(firstIndex) },
  };
  await f.put(1, earlier);
  await f.put(0);
  expect(await (await f.start()).result).toMatchObject({ ok: true, value: { prefix: f.prefix } });
});

it('rejects another producer epoch or a checkpoint beyond the admitted budget', async () => {
  const f = await fixture();
  await f.put(0);
  const approval = { ...f.approval, producerEpoch: '00000000-0000-4000-8000-000000000099' };
  expect(await (await f.start({ approval })).result).toEqual({ ok: false, reason: 'missing' });
  expect(await (await f.start({ maximumBytes: 8192 })).result).toEqual({ ok: false, reason: 'missing' });
});

it('rejects a directory that changed after the stopped identity was observed', async () => {
  const f = await fixture();
  await f.put(0);
  const root = await f.root();
  await writeFile(join(f.directory, 'unexpected'), '');
  expect(await (await f.start({ root })).result).toEqual({ ok: false, reason: 'custody' });
});

it('does not follow a checkpoint symlink', async () => {
  const f = await fixture();
  await f.put(0);
  await symlink(f.slot(0), f.slot(1));
  expect(await (await f.start()).result).toEqual({ ok: false, reason: 'custody' });
});

it('does not publish a valid checkpoint whose retained archive prefix was overwritten', async () => {
  const f = await fixture();
  await f.put(0);
  const path = join(f.directory, f.prefix.data.relativePath);
  const bytes = (await readFile(path, 'utf8')).replace('"sum":2', '"sum":9');
  await writeFile(path, bytes);
  expect(await (await f.start()).result).toEqual({ ok: false, reason: 'integrity' });
});

it('rejects conflicting complete slots for the same window count', async () => {
  const f = await fixture();
  await f.put(0);
  await f.put(1, { ...f.prefix, data: { ...f.prefix.data, sha256: sha('conflicting digest') } });
  expect(await (await f.start()).result).toEqual({ ok: false, reason: 'integrity' });
});
