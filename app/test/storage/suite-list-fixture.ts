import type { DatabaseSync } from 'node:sqlite';
import type { FolderPage, SuitePage, SuiteRevision, SuiteListQuery } from '@beetle/contracts/api';
import { initialize } from '../../src/adapters/outbound/sqlite/schema.js';
import type { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { prepareRunCommand } from '../../src/application/runs/index.js';
import { seedFoundation } from './execution-foundation-fixtures.js';
import { command, digest, requestId, scope, uuid } from './fixture.js';
import { runRequest } from './runs-fixture.js';
import { request, suiteCommand } from './suites-fixture.js';

export const time = (minute: number) => `2026-11-09T00:${String(minute).padStart(2, '0')}:00.000Z`;
/** Synchronous worker-store fixture: suite 50 (revision 60) in root folder 3, plus folder 90 under the root. */
export function suiteListFixture(): {
  db: DatabaseSync;
  store: Store;
  suite(id: number, name: string, folder?: number, revision?: number): void;
  run(revision: number, id: number, minute: number): void;
  list(query: Omit<SuiteListQuery, 'limit'> & { limit?: number }): SuitePage;
  folders(parent?: number): FolderPage;
  revision(id: number): SuiteRevision;
  ids(page: SuitePage): number[];
} {
  const db = initialize(':memory:');
  const store = seedFoundation(db, 10_000_000);
  store.execute({ kind: 'namespace', command: command({ kind: 'createFolder', id: uuid(90),
    request: { requestId: requestId(), scope, name: 'Load folder', parentFolderId: uuid(3) } }) });
  return {
    db,
    store,
    suite(id, name, folder = 90, revision) {
      store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuite', id: uuid(id),
        request: { scope, requestId: requestId(), name, folderId: uuid(folder) } }) });
      if (revision !== undefined)
        store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuiteRevision', savedAt: time(0), id: uuid(revision),
          suiteId: uuid(id), request: request() }) });
    },
    run(revision, id, minute) {
      store.execute({ kind: 'run', command: prepareRunCommand({ kind: 'createRun', id: uuid(id), attemptId: uuid(id + 100),
        requestedAt: time(minute), request: runRequest(uuid(revision)) }, digest) });
    },
    list: (query) => store.execute({ kind: 'listSuites', query: { scope, limit: 100, ...query } }) as SuitePage,
    folders: (parent = 3) => store.execute({ kind: 'list', query: { kind: 'folder', scope,
      parentFolderId: uuid(parent), limit: 100 } }) as unknown as FolderPage,
    revision: (id) => store.execute({ kind: 'getRevision', key: { scope, id: uuid(id) } }) as SuiteRevision,
    ids: (page) => page.items.map((item) => Number(item.id.slice(-12))),
  };
}
