import { expect, it, vi } from 'vitest';
import { createEngineCatalog } from '../../src/catalog/index.js';
import { createAgentServer } from '../../src/transport/index.js';
import { createEntry, identity } from '../../src/installation/entry.js';
import { configuration } from '../admission/fixtures.js';
import { offer, registration } from '../catalog/fixtures.js';
import { fixture, operation, scope, deferred } from './fixtures.js';
import { entries, managers } from './delivery-fixtures.js';

const f = fixture(); const create = managers();
const refusal = { state: 'rejected', reason: 'below_manifest_minimum' };
const fields = ['cpuMillis', 'memoryBytes', 'pids', 'timeoutMs', 'outputBytes'] as const;

async function setup() {
  const e = await f.setup(); const installed = registration(); const catalog = createEngineCatalog([installed]);
  const config = configuration(); config.profiles = catalog.engines.map(engine => structuredClone(engine.approved));
  await e.owner.admission({ kind: 'configure', configuration: config });
  const stager = vi.fn((): never => { throw new Error('unexpected staging'); });
  const manager = create({ ...e.options, catalog, stagerFor: stager });
  return { ...e, installed, catalog, stager, manager };
}

it('persists each real catalogue below-minimum original and closes indexed refusal debt with no execution', async () => {
  const e = await setup();
  for (const [index, field] of fields.entries()) {
    const source = offer(e.installed); source.attemptId = f.job(index + 1).attemptId;
    source.budget[field] = e.installed.manifest.minimumBudget[field] - 1;
    const key = scope(source);
    expect(await e.manager.enqueue(source)).toEqual({ accepted: false, decision: { kind: 'reject', reason: refusal.reason } });
    expect(await e.owner.readOffer(key)).toEqual(source);
    expect(await e.manager.inspect(key)).toMatchObject({ snapshot: { lastSeq: 0, admission: refusal }, allocation: null });
    expect((await e.owner.scanRunnable({ lane: 'delivery', limit: 10 })).attempts).toEqual([key]);
    expect(await e.owner.readOutputAbsence(key)).toBeNull();
    expect(await e.manager.drive(key, operation())).toEqual({ kind: 'rejected', reason: refusal.reason });
    expect(await e.owner.readOutputAbsence(key)).toMatchObject({ admission: refusal, finalAgentSeq: 0, reason: 'budget_unavailable' });
    expect((await e.owner.scanRunnable({ lane: 'delivery', limit: 10 })).attempts).toEqual([]);
    expect((await e.manager.enqueue(source))).toMatchObject({ accepted: true, snapshot: { admission: refusal, lastSeq: 0 } });
    await expect(e.manager.enqueue({ ...source, budget: e.installed.manifest.minimumBudget })).rejects.toMatchObject({ code: 'conflict' });
  }
  expect(e.stager).not.toHaveBeenCalled(); expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
  expect(e.backend.stops).toEqual([]); expect(e.backend.kills).toBe(0); expect(entries(e.manager).size).toBe(0);
});

it('keeps a real intake rejection pending until its native owner closes, then serves the actual HTTP absence marker', async () => {
  const e = await setup(); const source = offer(e.installed); source.budget.cpuMillis = 999;
  const key = scope(source); const gate = deferred<void>(); const entered = deferred<void>();
  const authority = await e.owner.journalAuthority();
  const outputs = vi.fn(async (): Promise<never> => { throw new Error('unexpected source production'); });
  const app = createAgentServer({ credential: 'S'.repeat(64), journalAuthority: authority, installation: e.manager,
    journal: e.owner, absences: e.owner, outputs: { source: outputs, chunk: outputs },
    capabilities: async (): Promise<never> => { throw new Error('unexpected capabilities'); } });
  const path = `/runner/v1/attempts/${key.attemptId}`;
  const headers = { authorization: `Bearer ${'S'.repeat(64)}`, 'x-beetle-organization-id': key.organizationId,
    'x-beetle-workspace-id': key.workspaceId, 'x-beetle-generation': '1', 'x-beetle-journal-authority': authority };
  let driving: Promise<unknown> | undefined;
  try {
    const rejected = await app.inject({ method: 'PUT', url: path, headers, payload: source });
    expect(rejected.statusCode).toBe(422); expect(rejected.json()).toMatchObject({ reason: 'budget_unavailable', retry: 'never' });
    expect((await app.inject({ url: path, headers })).json()).toMatchObject({ admission: refusal, lastSeq: 0 });
    const entry = createEntry(key); entry.watch = { initial: Promise.resolve({ ready: true }),
      status: () => ({ ready: true, closed: false, stopRequested: false, lastKnownAt: 0 }),
      close: async () => { entered.resolve(); await gate.promise; } };
    entries(e.manager).set(identity(key), entry);
    const close = vi.spyOn(e.owner, 'closeOutputAbsence');
    driving = e.manager.drive(key, operation()); await entered.promise;
    expect(close).not.toHaveBeenCalled(); expect(await e.owner.readOutputAbsence(key)).toBeNull();
    const pending = await app.inject({ url: `${path}/source/absence`, headers });
    expect(pending.statusCode).toBe(409); expect(pending.json()).toMatchObject({ reason: 'source_pending' });
    gate.resolve(); expect(await driving).toEqual({ kind: 'rejected', reason: refusal.reason });
    const proof = await app.inject({ url: `${path}/source/absence`, headers });
    expect(proof.statusCode).toBe(200); expect(proof.json()).toMatchObject({ admission: refusal, finalAgentSeq: 0 });
    const marker = await app.inject({ url: `${path}/source`, headers });
    expect(marker.statusCode).toBe(409); expect(marker.json()).toMatchObject({ reason: 'source_absent', retry: 'never' });
    expect(outputs).not.toHaveBeenCalled(); expect(e.stager).not.toHaveBeenCalled();
    expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
    await e.manager.close(); await f.close(e.owner);
    const reopened = await f.open(e.journalPath);
    expect(await reopened.readOffer(key)).toEqual(source);
    expect(await reopened.readOutputAbsence(key)).toEqual(proof.json());
  } finally { gate.resolve(); await Promise.allSettled([driving]); await app.close(); }
});
