import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
import { settingsFixture } from '../storage/fixture.js';

const fixture = runFixture(10_000_000);
it('recovers a lost cancellation response over real HTTP and restart without fabricating execution', async () => {
  const first = await fixture.open(undefined, {}, true);
  const initial = await client(first.app, false, first.origin, true);
  const saved = await savedSuite(initial.api);
  const run = value(await initial.api.createRun({ params: saved.params, body: { scope: saved.scope,
    requestId: randomUUID(), revisionId: saved.pinned.id, engineProfile: 'standard',
    budget: settingsFixture().chain.installation.values.runDefaults.budget,
    executionPolicy: { mode: 'parallel', preferIdle: false } } }));
  const input = { params: { ...saved.params, runId: run.id },
    body: { scope: saved.scope, requestId: randomUUID() } };
  expect(await initial.api.cancelRun(input)).toMatchObject({ ok: false, error: { kind: 'transport' } });
  // The committed server response is observed independently of client error mapping.
  expect(initial.observed.status).toBe(202);
  const receipt = initial.observed.run!;
  expect(receipt).toMatchObject({ id: run.id, version: 2, state: 'cancelled',
    outcome: 'inconclusive', validationStatus: 'pending', cancellationRequested: true, reason: 'cancelled' });
  await fixture.close(first.app);
  const next = await fixture.open(first.path, { runtime: null, runs: { profiles: [], pendingLimit: 1 } }, true);
  const restarted = await client(next.app, false, next.origin);
  expect(value(await restarted.api.cancelRun(input))).toEqual(receipt);
  expect(value(await restarted.api.getRun({ params: input.params }))).toEqual(receipt);
  expect(await restarted.api.cancelRun({ ...input, body: { ...input.body, requestId: run.id } }))
    .toEqual({ ok: true, value: receipt });
  await fixture.close(next.app);
  const db = new DatabaseSync(first.path, { enableForeignKeyConstraints: true });
  try {
    expect(db.prepare('SELECT state,generation FROM attempts').get()).toEqual({ state: 'offered', generation: null });
    for (const table of ['dispatch_outbox', 'execution_records', 'attempt_output_allocations']) {
      expect(db.prepare(`SELECT count(*) AS n FROM ${table}`).get()?.n).toBe(0);
    }
    expect(db.prepare('SELECT count(*) AS n FROM receipts WHERE request_id=?').get(input.body.requestId)?.n).toBe(1);
    expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  } finally { db.close(); }
});
