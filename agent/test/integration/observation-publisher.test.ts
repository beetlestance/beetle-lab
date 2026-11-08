import { expect, it, vi } from 'vitest';
import { createObservationPublisher, createResourceObserver } from '../../src/observation/index.js';
import { createOutputGuard } from '../../src/guard/index.js';
import { createTimeoutGuard } from '../../src/timeout/index.js';
import type { DockerReply, DockerTransport } from '../../src/backends/docker/index.js';
import { deferred } from '../supervisor/fixtures.js';
import { fixture } from '../staging/fixtures.js';
import { configuration, now } from '../admission/fixtures.js';
import { resourceVersion as version, resourceInfo as info, resourceTransport } from './resource-fixtures.js';

const f = fixture();

it('uses actual guard lifetimes and observer/journal composition to gate admission', async () => {
  const e = await f.environment(false); await f.close(e.owner); const journal = await f.open(e.journalPath);
  let wall = now + 1;
  const port: DockerTransport = resourceTransport();
  const observer = createResourceObserver({ root: e.options.root, transport: port, configuration: configuration(), wallNow: () => wall });
  const output = createOutputGuard({ root: e.options.root, minimumFreeBytes: 0, stop: async () => undefined });
  const timeout = createTimeoutGuard({ wallNow: () => wall, stop: async () => undefined });
  const publisher = createObservationPublisher({ journal, observer, output, timeout, intervalMs: 20,
    sampleTimeoutMs: 1000, ttlMs: 5000, wallNow: () => wall });
  output.start(); publisher.start();
  try {
    expect(await publisher.initial).toEqual({ ready: false });
    expect(await f.enqueue(journal, e.offer, wall)).toMatchObject({ kind: 'defer', reason: 'queued' });
    expect(await f.admit(journal, e.offer, wall)).toMatchObject({ kind: 'defer', reason: 'capacity_unknown' });
    wall++; timeout.start();
    await vi.waitFor(() => { expect(publisher.status().ready).toBe(true); });
    expect(await f.admit(journal, e.offer, wall)).toMatchObject({ status: 'charged' });
    wall++; await publisher.close();
    const next = f.job(2); await f.enqueue(journal, next, wall);
    expect(await f.admit(journal, next, wall)).toMatchObject({ kind: 'defer', reason: 'capacity_unknown' });
  } finally { await publisher.close(); await observer.close(); await output.close(); await timeout.close(); }
});

it('revokes admission during a held real observer original and drains it before clean close', async () => {
  const e = await f.environment(false); await f.close(e.owner); const journal = await f.open(e.journalPath);
  let wall = now + 1; let hold = false; const original = deferred<DockerReply>();
  const request = vi.fn(async (input: Parameters<DockerTransport['request']>[0]) => {
    if (input.path !== '/version') return info;
    return hold ? original.promise : version;
  });
  const observer = createResourceObserver({ root: e.options.root, transport: { request }, configuration: configuration(), wallNow: () => wall });
  const output = createOutputGuard({ root: e.options.root, minimumFreeBytes: 0, stop: async () => undefined });
  const timeout = createTimeoutGuard({ wallNow: () => wall, stop: async () => undefined });
  const publisher = createObservationPublisher({ journal, observer, output, timeout, intervalMs: 20,
    sampleTimeoutMs: 1000, ttlMs: 5000, wallNow: () => wall });
  output.start(); timeout.start(); publisher.start(); let closing: Promise<void> | undefined;
  try {
    expect(await publisher.initial).toEqual({ ready: true });
    hold = true; wall++;
    await vi.waitFor(() => { expect(request.mock.calls.filter(([input]) => input.path === '/version').length).toBeGreaterThan(1); });
    await timeout.close();
    await vi.waitFor(() => { expect(publisher.status().ready).toBe(false); });
    await f.enqueue(journal, e.offer, wall);
    await vi.waitFor(async () => {
      expect(await f.admit(journal, e.offer, wall)).toMatchObject({ kind: 'defer', reason: 'capacity_unknown' });
    });
    let closed = false; closing = publisher.close().then(() => { closed = true; });
    await Promise.resolve(); expect(closed).toBe(false);
  } finally {
    original.resolve(version); await closing; await publisher.close(); await observer.close(); await output.close(); await timeout.close();
  }
});
