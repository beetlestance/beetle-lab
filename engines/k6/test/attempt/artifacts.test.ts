import * as fs from 'node:fs/promises';
import { promises as realFs } from 'node:fs';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { Artifacts } from '../../wrapper/artifact-custody/index.js';
import { AttemptFence } from '../../wrapper/lifecycle/index.js';
import { numericAllowance, reserveOutput } from '../../wrapper/attempt/reservation.js';
import { encodeJson } from '@beetle/contracts';

vi.mock('node:fs/promises', async importOriginal => {
  const actual = await importOriginal<typeof fs>();
  return { ...actual, open: vi.fn(actual.open) };
});

const cleanup: (() => Promise<unknown> | void)[] = [];
afterEach(async () => { vi.restoreAllMocks(); await Promise.all(cleanup.splice(0).map(work => work())); });
async function setup() {
  const directory = await fs.mkdtemp('/private/tmp/w09-attempt-custody-');
  cleanup.push(() => fs.rm(directory, { recursive: true, force: true }));
  const fence = new AttemptFence({ wall: Date.now, monotonic: () => performance.now() }, new AbortController().signal, 5000);
  cleanup.push(() => fence.dispose());
  return { directory, fence, artifacts: new Artifacts({ directory, uid: process.getuid!(), fence }) };
}
it('does not declare summary metadata from a trusted hash without real filesystem custody', async () => {
  const f = await setup(); await fs.writeFile(join(f.directory, 'beetle-evidence.json'), '{}', { mode: 0o600 });
  await expect(f.artifacts.summary({ version: 2, timing: { testRunDurationMs: null }, metrics: {},
    rawBytes: 2, sha256: '0'.repeat(64), nativeCollection: 'complete' })).rejects.toMatchObject({ reason: 'artifact' });
  expect(f.artifacts.quiescence).toBe('confirmed');
});
it('retains original descriptor-close failure and does not declare a partially successful numeric file', async () => {
  const f = await setup(); const original = realFs.open;
  vi.spyOn(fs, 'open').mockImplementation(async (...args: Parameters<typeof fs.open>) => {
    const handle = await original(...args);
    if (args[0] === join(f.directory, 'numeric-final.json')) {
      const close = handle.close.bind(handle);
      handle.close = async () => { await close(); throw new Error('SECRET_FD_CLOSE'); };
    }
    return handle;
  });
  await expect(f.artifacts.numeric({ version: 1, quantiles: 'unknown' })).rejects.toMatchObject({ reason: 'cleanup' });
  expect(f.artifacts.quiescence).toBe('failed');
  expect(await fs.readFile(join(f.directory, 'numeric-final.json'), 'utf8')).toContain('unknown');
});
it('rejects final serialization overflow before creating a numeric file', async () => {
  const f = await setup();
  await expect(f.artifacts.numeric({ data: 'x'.repeat(1_048_576) })).rejects.toMatchObject({ reason: 'output_limit' });
  await expect(fs.lstat(join(f.directory, 'numeric-final.json'))).rejects.toMatchObject({ code: 'ENOENT' });
});
it('rejects cancellation before any artifact IO', async () => {
  const f = await setup(); f.fence.stop('cancelled');
  await expect(f.artifacts.numeric({ version: 1 })).rejects.toMatchObject({ reason: 'cancelled' });
  expect(await fs.readdir(f.directory)).toEqual([]);
});
it('counts LF and accepts the exact remaining collect allowance', async () => {
  const f = await setup(); const value = { version: 1, quantiles: 'unknown' };
  const bytes = Buffer.byteLength(encodeJson(value, 1_048_576)) + 1;
  const remaining = numericAllowance(reserveOutput(8_388_608), 1_048_576, 1_048_576 - bytes);
  const artifact = await f.artifacts.numeric(value, remaining);
  expect(artifact.bytes).toBe(bytes); expect((await fs.stat(join(f.directory, 'numeric-final.json'))).size).toBe(bytes);
});
it('rejects one byte short before numeric open/write/sync', async () => {
  const f = await setup(); const value = { version: 1, quantiles: 'unknown' };
  const bytes = Buffer.byteLength(encodeJson(value, 1_048_576)) + 1;
  const opened = vi.mocked(fs.open); opened.mockClear();
  const remaining = numericAllowance(reserveOutput(8_388_608), 1_048_576, 1_048_576 - bytes + 1);
  await expect(f.artifacts.numeric(value, remaining)).rejects.toMatchObject({ reason: 'output_limit' });
  expect(opened).not.toHaveBeenCalled(); expect(await fs.readdir(f.directory)).toEqual([]);
});
it('rejects report cancellation and overflow before opening any artifact', async () => {
  const f = await setup(); const opened = vi.mocked(fs.open); opened.mockClear();
  await expect(f.artifacts.report('performance-report', Buffer.from('report\n'), 6)).rejects.toMatchObject({reason: 'output_limit'});
  expect(opened).not.toHaveBeenCalled(); expect(await fs.readdir(f.directory)).toEqual([]);
  f.fence.stop('cancelled');
  await expect(f.artifacts.report('metrics-csv', Buffer.from('header\n'), 262144)).rejects.toMatchObject({reason: 'cancelled'});
  expect(opened).not.toHaveBeenCalled();
});
it('captures report bytes before asynchronous custody and verifies the exact accepted file', async () => {
  const f = await setup(); const content = Buffer.from('bounded report\n'); const expected = Buffer.from(content);
  const original = f.artifacts.report('performance-report', content, content.length); content.fill(0);
  const artifact = await original;
  expect(artifact).toMatchObject({kind: 'performance-report', relativePath: 'performance-report.txt', bytes: expected.length});
  expect(await fs.readFile(join(f.directory, artifact.relativePath))).toEqual(expected);
});
