import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { encodeRevisionListCursor } from '@beetle/contracts/api';
import { runFixture, client, savedSuite, value } from './run-fixture.js';
const f = runFixture();
it('serves ordinal revision pages, refuses false bookmarks and preserves full revision replies through HTTP and reopen', async () => {
 const running = await f.open(undefined, {}, true);
 const connection = await client(running.app, false, running.origin);
 const saved = await savedSuite(connection.api);
 const params = { ...saved.params, suiteId: saved.pinned.suiteId };
 const revisions = [saved.pinned];
 for (let expectedVersion = 2; expectedVersion <= 3; expectedVersion++) revisions.push(value(await connection.api.createSuiteRevision({ params, body: {
  scope: saved.scope, requestId: randomUUID(), expectedVersion, engineId: 'k6', configVersion: 1, config: saved.pinned.config,
 } })));
 const first = value(await connection.api.listSuiteRevisions({ params, query: { limit: 1 } }));
 expect(first.items[0]).toMatchObject({ id: revisions[2]!.id, ordinal: 3, previousRevisionId: revisions[1]!.id });
 const second = value(await connection.api.listSuiteRevisions({ params, query: { limit: 1, cursor: first.nextCursor! } }));
 expect(second.items[0]).toMatchObject({ id: revisions[1]!.id, ordinal: 2, previousRevisionId: revisions[0]!.id });
 const last = value(await connection.api.listSuiteRevisions({ params, query: { limit: 1, cursor: second.nextCursor! } }));
 expect(last.items[0]).toMatchObject({ id: revisions[0]!.id, ordinal: 1, previousRevisionId: null });
 expect(last.nextCursor).toBeNull();
 const wrong = encodeRevisionListCursor({ scope: saved.scope, suiteId: params.suiteId, limit: 1, ordinal: 2, id: saved.pinned.id });
 const refusal = await connection.api.listSuiteRevisions({ params, query: { limit: 1, cursor: wrong } });
 expect(refusal).toMatchObject({ ok: false, error: { protocol: { code: 'malformed_request' } } });
 expect(value(await connection.api.getSuiteRevision({ params: { ...saved.params, revisionId: saved.pinned.id } }))).toEqual(saved.pinned);
 await f.close(running.app);
 const reopened = await f.open(running.path, { runtime: null, runs: { profiles: [], pendingLimit: 1 } }, true);
 const next = await client(reopened.app, false, reopened.origin);
 expect(value(await next.api.listSuiteRevisions({ params, query: { limit: 1 } }))).toEqual(first);
});
