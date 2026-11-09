import { afterEach, expect, it, vi } from 'vitest';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { startRuntimePoller } from '../../src/bootstrap/runtime-poller.js';
import type { RuntimePoller } from '../../src/bootstrap/runtime-poller.js';
import { createRuntimePublisher } from '../../src/bootstrap/runtime-publication.js';
import type { CapacitySource } from '../../src/ports/runtime.js';
import { observation, settingsFixture, storageFixture } from '../storage/fixture.js';
const pollers: RuntimePoller[] = [];
afterEach(async () => { for (const poller of pollers.splice(0)) await poller.close(); });
const fixture = storageFixture();
async function afterClock(previous: number): Promise<void> {
  for (let turn = 0; turn < 100 && Date.now() <= previous; turn++) await new Promise(resolve => setTimeout(resolve, 1));
  expect(Date.now()).toBeGreaterThan(previous);
}
async function published(poller: RuntimePoller): Promise<void> {
  for (let turn = 0; turn < 100 && poller.state().status !== 'published'; turn++) await new Promise(resolve => setTimeout(resolve, 5));
  expect(poller.state()).toMatchObject({ status: 'published', reason: null });
}
it('recovers from a real cache bootstrap fence without repeatedly writing null', async () => {
  const old = observation(settingsFixture().runtime, Date.now() - 1);
  const metadata = await fixture.open(undefined, { runtime: null }); await afterClock(Date.now());
  const sample = vi.fn<CapacitySource['sample']>().mockImplementation(async () => observation());
  sample.mockResolvedValueOnce(old);
  const publish = vi.fn(createRuntimePublisher(metadata)); const close = vi.fn().mockResolvedValue(undefined);
  const poller = startRuntimePoller({ source: { sample, close }, publish, intervalMs: 25 }); pollers.push(poller);
  await published(poller);
  expect(await publish.mock.results[0]!.value).toBe(false);
  expect(publish.mock.calls.every(([fact]) => fact !== null)).toBe(true);
  expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
});
it('refuses source expiry across the real worker queue then publishes a genuinely newer sample', async () => {
  const entry = join(fixture.root(), 'source-expiry.mjs');
  await writeFile(entry, `import {parentPort} from 'node:worker_threads';
    const originalNow=Date.now;let first=true;
    parentPort.on('message',command=>{if(command.kind==='runtime'&&command.runtime!==null){
      if(first){first=false;const later=command.runtime.observedAtMs+100;Date.now=()=>later;}
      else Date.now=originalNow;
    }});await import(${JSON.stringify(fixture.workerUrl().href)});`);
  const metadata = await fixture.open(undefined, { runtime: null, workerUrl: pathToFileURL(entry) });
  await afterClock(Date.now());
  let calls = 0;
  const sample: CapacitySource['sample'] = async () => observation(settingsFixture().runtime, Date.now(), ++calls === 1 ? 50 : 1000);
  const publish = vi.fn(createRuntimePublisher(metadata));
  const poller = startRuntimePoller({ source: { sample, close: async () => undefined }, publish, intervalMs: 25 }); pollers.push(poller);
  await published(poller);
  expect(await publish.mock.results[0]!.value).toBe(false);
  expect(publish.mock.calls[0]![0]!.expiresAtMs - publish.mock.calls[0]![0]!.observedAtMs).toBe(50);
  expect(publish.mock.calls.every(([fact]) => fact !== null)).toBe(true);
  expect((await metadata.getSettings({ kind: 'installation' })).version).toBe(1);
});
it('coalesces a real known-to-unknown transition while an old frame is refused before recovery', async () => {
  const metadata = await fixture.open(undefined, { runtime: null }); await afterClock(Date.now());
  const first = observation(); let calls = 0;
  const sample: CapacitySource['sample'] = async () => {
    calls++;
    if (calls === 1 || calls === 3) return first;
    return calls === 2 ? null : observation();
  };
  const publish = vi.fn(createRuntimePublisher(metadata));
  const poller = startRuntimePoller({ source: { sample, close: async () => undefined }, publish, intervalMs: 25 }); pollers.push(poller);
  for (let turn = 0; turn < 100 && publish.mock.results.length < 4; turn++) await new Promise(resolve => setTimeout(resolve, 5));
  await published(poller);
  const earliest = publish.mock.results.slice(0, 4);
  expect(await Promise.all(earliest.map(result => result.value))).toEqual([true, true, false, true]);
  expect(publish.mock.calls.slice(0, 4).map(([fact]) => fact?.observedAtMs ?? null))
    .toEqual([first.observedAtMs, null, first.observedAtMs, expect.any(Number)]);
  expect(publish.mock.calls[3]![0]!.observedAtMs).toBeGreaterThan(first.observedAtMs);
  expect(publish.mock.calls.filter(([fact]) => fact === null)).toHaveLength(1);
});
