import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import type { CreateRunRequest } from '@beetle/contracts/api';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
import { settingsFixture } from '../storage/fixture.js';

const fixture = runFixture(10_000_000);
it('replays a lost successful enqueue across restart with exactly one persisted execution intent', async () => {
  const first = await fixture.open(undefined, {}, true);
  const initial = await client(first.app, true, first.origin);
  const saved = await savedSuite(initial.api);
  const body: CreateRunRequest = { scope: saved.scope, requestId: randomUUID(), revisionId: saved.pinned.id,
    engineProfile: 'standard', budget: settingsFixture().chain.installation.values.runDefaults.budget,
    executionPolicy: { mode: 'parallel', preferIdle: false } };
  expect(await initial.api.createRun({ params: saved.params, body })).toMatchObject({ ok: false, error: { kind: 'transport' } });
  // Assert outside the fetch callback: client error mapping cannot swallow this oracle.
  expect(initial.observed.status).toBe(202); expect(initial.observed.run).toBeDefined();
  const original = initial.observed.run!;
  expect(value(await initial.api.createRun({ params: saved.params, body }))).toEqual(original);
  expect(value(await initial.api.getRun({ params: { ...saved.params, runId: original.id } }))).toEqual(original);
  expect(value(await initial.api.listRuns({ params: saved.params, query: { limit: 1 } })).items).toEqual([original]);
  await fixture.close(first.app);
  const next = await fixture.open(first.path, { runtime: null, runs: { profiles: [], pendingLimit: 1 } }, true);
  const restarted = await client(next.app, false, next.origin);
  expect(value(await restarted.api.createRun({ params: saved.params, body }))).toEqual(original);
  expect(await restarted.api.createRun({ params: saved.params, body: { ...body, requestId: randomUUID() } }))
    .toMatchObject({ ok: false, error: { status: 503 } });
  expect(await restarted.api.createRun({ params: saved.params,
    body: { ...body, executionPolicy: { mode: 'isolated', preferIdle: false } } }))
    .toMatchObject({ ok: false, error: { status: 409 } });
  await fixture.close(next.app);
  const db = new DatabaseSync(first.path, { enableForeignKeyConstraints: true });
  try {
    for (const table of ['runs', 'attempts', 'dispatch_outbox']) expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(1);
    expect(db.prepare('SELECT id,active_attempt_id FROM runs').get()).toEqual({ id: original.id, active_attempt_id: original.activeAttemptId });
    expect(db.prepare('SELECT state,generation FROM attempts').get()).toEqual({ state: 'offered', generation: null });
    expect(db.prepare('SELECT possible_delivery FROM dispatch_outbox').get()).toEqual({ possible_delivery: 0 });
    const receipt = db.prepare('SELECT result_json FROM receipts WHERE request_id=?').get(body.requestId);
    expect(JSON.parse(String(receipt?.result_json))).toEqual(original);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
it('returns unavailable for a fresh run without private profile pins and never claims execution', async () => {
  const { app, path } = await fixture.open(undefined, { runs: { profiles: [], pendingLimit: 1 } });
  const { api } = await client(app); const saved = await savedSuite(api);
  const body: CreateRunRequest = { scope: saved.scope, requestId: randomUUID(), revisionId: saved.pinned.id,
    engineProfile: 'standard', budget: settingsFixture().chain.installation.values.runDefaults.budget,
    executionPolicy: { mode: 'parallel', preferIdle: false } };
  expect(await api.createRun({ params: saved.params, body })).toMatchObject({ ok: false, error: { status: 503 } });
  expect(value(await api.listRuns({ params: saved.params, query: { limit: 10 } })).items).toEqual([]);
  await fixture.close(app); const db = new DatabaseSync(path);
  try { expect(db.prepare('SELECT count(*) AS n FROM runs').get()?.n).toBe(0); }
  finally { db.close(); }
});
