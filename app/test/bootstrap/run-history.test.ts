import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { createApiClient } from '@beetle/contracts/api';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
import { settingsFixture } from '../storage/fixture.js';
const fixture = runFixture();
it('serves bound history through actual application HTTP and compiled SQLite worker across reopen without execution', async () => {
  const first = await fixture.open(); const paired = await client(first.app); const saved = await savedSuite(paired.api);
  const submitted = [];
  for (let i = 0; i < 3; i++) submitted.push(value(await paired.api.createRun({ params: saved.params, body: {
    scope: saved.scope, requestId: randomUUID(), revisionId: saved.pinned.id, engineProfile: 'standard',
    budget: settingsFixture().chain.installation.values.runDefaults.budget, executionPolicy: { mode: 'parallel', preferIdle: false } } })));
  const sorted = submitted.toSorted((a,b) => b.requestedAt.localeCompare(a.requestedAt) || b.id.localeCompare(a.id));
  const page = value(await paired.api.listRuns({ params: saved.params, query: { limit: 2, state: 'queued', outcome: 'pending' } }));
  expect(page.items).toEqual(sorted.slice(0,2)); expect(page.nextCursor).not.toBeNull();
  const search = value(await paired.api.listRuns({ params: saved.params, query: { limit: 2, name: 'Synthetic suite' } }));
  expect(search.items).toEqual(sorted.slice(0, 2)); expect(search.nextCursor).not.toBeNull();
  expect(value(await paired.api.listRuns({ params: saved.params, query: { limit: 2, runIdPrefix: sorted[0]!.id } })).items).toEqual([sorted[0]]);
  const next = value(await paired.api.listRuns({ params: saved.params, query: { limit: 2, state: 'queued', outcome: 'pending', cursor: page.nextCursor! } }));
  expect(next.items).toEqual(sorted.slice(2)); expect(next.nextCursor).toBeNull();
  expect(value(await paired.api.listRuns({ params: saved.params, query: { limit: 2, order: 'oldest' } })).items).toEqual(sorted.toReversed().slice(0,2));
  expect(value(await paired.api.listRuns({ params: saved.params, query: { limit: 2, state: 'active' } })).items).toEqual([]);
  const raw = async (suffix: string) => createApiClient({ baseUrl: 'http://127.0.0.1:43179', fetch: async input => {
    const url = new URL(String(input)); url.search = suffix;
    const response = await first.app.server.inject({ method: 'GET', url: url.pathname + url.search,
      headers: { host: url.host, origin: url.origin } });
    return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
  } }).listRuns({ params: saved.params, query: { limit: 2 } });
  // Pairing is still enforced on raw requests, independently of query interpretation.
  expect(await raw('limit=2')).toMatchObject({ ok: false, error: { status: 401 } });
  await fixture.close(first.app); const db = new DatabaseSync(first.path);
  expect(db.prepare('SELECT COUNT(*) AS n FROM runs').get()?.n).toBe(3);
  expect(db.prepare('SELECT COUNT(*) AS n FROM attempts').get()?.n).toBe(3);
  expect(db.prepare('SELECT SUM(possible_delivery) AS n FROM dispatch_outbox').get()?.n).toBe(0); db.close();
  const second = await fixture.open(first.path, { runtime: null, runs: { profiles: [], pendingLimit: 1 } });
  const reopened = await client(second.app);
  expect(value(await reopened.api.listRuns({ params: saved.params, query: { limit: 2, name: 'synthetic suite', cursor: search.nextCursor! } })).items).toEqual(sorted.slice(2));
  expect(value(await reopened.api.listRuns({ params: saved.params, query: { limit: 2, state: 'queued', outcome: 'pending', cursor: page.nextCursor! } }))).toEqual(next);
});
