import { readFile, writeFile, appendFile, rename, symlink, truncate } from 'node:fs/promises';
import { afterEach, expect, it, vi } from 'vitest';
import { jsonNodeCount } from '@beetle/contracts';
import { encodeLiveMetricHistory } from '@beetle/contracts/api';
import { nodePorts } from '../../src/collection/output/index.js';
import { nativeCustody } from '../../src/collection/native-custody/index.js';
import { historyFixture, sha } from './fixtures.js';
import { targetFixture } from './target-fixtures.js';

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { vi.restoreAllMocks(); for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
it('returns complete verified target samples with phases, original units and unknowns preserved', async () => {
  const f = await historyFixture(cleanups); const target = await targetFixture(f);
  const reply = await f.start().result; expect(reply.ok).toBe(true); if (!reply.ok) throw Error(reply.reason);
  expect(reply.value.targetSamples).toEqual(target.samples);
  expect(reply.value.targetSamples?.map(sample => sample.phase)).toEqual(['before', 'during', 'after']);
  expect(reply.value.targetSamples?.[1]).toMatchObject({ status: 'unavailable', reason: 'http', values: { rss: null, 'gc.totalMs': null } });
  expect(reply.value.targetSamples?.[2]?.values['gc.totalMs']).toBe(3);
  expect(() => encodeLiveMetricHistory(reply.value, sha)).not.toThrow();
});
it('reads only the completed target extent while later partial samples are being appended', async () => {
  const f = await historyFixture(cleanups); const target = await targetFixture(f);
  await appendFile(target.path, '{incomplete next sample');
  expect(await f.start().result).toMatchObject({ ok: true, value: { targetSamples: target.samples } });
});
it.each(['hash', 'scope', 'id', 'interval', 'sequence', 'unknown', 'value', 'suffix'] as const)('rejects target %s corruption before returning either history', async kind => {
  const f = await historyFixture(cleanups); const target = await targetFixture(f);
  if (kind === 'hash') await writeFile(target.path, target.text.replace('"rss":1', '"rss":9'));
  else if (kind === 'scope') await target.save(target.text.replaceAll(f.options.scope.attemptId, '00000000-0000-4000-8000-000000000099'));
  else if (kind === 'id') await target.save(target.text.replaceAll(target.prefix.data.artifactId, '00000000-0000-4000-8000-000000000099'));
  else if (kind === 'interval') await target.save(target.text.replace('"intervalMs":1000', '"intervalMs":2000'));
  else if (kind === 'sequence') await target.save(target.text.replace('"sequence":2', '"sequence":1'));
  else if (kind === 'unknown') await target.save(target.text.replace('"sample":{', '"unexpected":true,"sample":{'));
  else if (kind === 'value') await target.save(target.text.replace('"rss":1', '"rss":-1'));
  else await target.save(target.text + '{}\n');
  expect(await f.start().result).toEqual({ ok: false, reason: 'integrity' });
});
it.each(['symlink', 'truncated', 'replacement'] as const)('refuses target %s custody changes', async kind => {
  const f = await historyFixture(cleanups); const target = await targetFixture(f);
  if (kind === 'symlink') { await rename(target.path, target.path + '.moved'); await symlink(target.path + '.moved', target.path); }
  if (kind === 'truncated') await truncate(target.path, 1);
  let replaced = false;
  const ports = { ...nodePorts, open: vi.fn<typeof nodePorts.open>(async (...args) => {
    const handle = await nodePorts.open(...args);
    if (kind === 'replacement' && args[0] === target.path) {
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (...parameters) => {
        const value = await read(...parameters);
        if (!replaced) { replaced = true; const bytes = await readFile(target.path); await rename(target.path, target.path + '.moved'); await writeFile(target.path, bytes, { mode: 0o600 }); }
        return value;
      });
    }
    return handle;
  }) };
  expect(await f.start(ports).result).toEqual({ ok: false, reason: 'custody' });
});
it('reserves target bytes and nodes before compacting metrics, retaining all target samples and metric endpoints', async () => {
  const f = await historyFixture(cleanups, 300, 20); const target = await targetFixture(f, 256);
  const reply = await f.start().result; expect(reply.ok).toBe(true); if (!reply.ok) throw Error(reply.reason);
  expect(reply.value.targetSamples).toEqual(target.samples);
  expect(reply.value.samples[0]?.sequence).toBe(1); expect(reply.value.samples.at(-1)?.sequence).toBe(300);
  expect(reply.value.sampled).toBe(true); expect(jsonNodeCount(reply.value)).toBeLessThanOrEqual(65536);
  expect(encodeLiveMetricHistory(reply.value, sha).length).toBeLessThanOrEqual(2097152);
});
it('retains ignored-abort target reads and overlapping cleanup exclusion until original settlement', async () => {
  const f = await historyFixture(cleanups); const target = await targetFixture(f);
  let release!: () => void; let entered!: () => void;
  const gate = new Promise<void>(yes => { release = yes; }); const issued = new Promise<void>(yes => { entered = yes; });
  const ports = { ...nodePorts, open: vi.fn<typeof nodePorts.open>(async (...args) => {
    const handle = await nodePorts.open(...args);
    if (args[0] === target.path) {
      const read = handle.read.bind(handle);
      vi.spyOn(handle, 'read').mockImplementation(async (...parameters) => { entered(); await gate; return read(...parameters); });
    }
    return handle;
  }) };
  const operation = f.start(ports); await issued; const closing = operation.close();
  expect(await operation.result).toEqual({ ok: false, reason: 'closed' });
  let quiet = false; void operation.quiesced.then(() => { quiet = true; }); await Promise.resolve(); expect(quiet).toBe(false);
  const lease = nativeCustody.reserve('cleanup')!; lease.own({});
  try { expect(() => lease.bind(f.directory)).toThrow(expect.objectContaining({ reason: 'busy' })); }
  finally { lease.release(); release(); }
  await closing; await operation.quiesced; expect(quiet).toBe(true);
});
