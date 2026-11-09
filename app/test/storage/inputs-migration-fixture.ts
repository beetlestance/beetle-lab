import { DatabaseSync } from 'node:sqlite';
import { migration001 } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../src/adapters/outbound/sqlite/migration002.js';
import { Store } from '../../src/adapters/outbound/sqlite/store.js';
import { command, observation, requestId, scope, settingsFixture, uuid } from './fixture.js';
import { request, suiteCommand } from './suites-fixture.js';

export function legacyDatabase(path: string, count = 1) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(migration001); db.exec(migration002);
  const store = new Store(db, { installation: settingsFixture().chain.installation, runtime: observation() });
  const original = command({ kind: 'createOrganization', id: uuid(1), request: {
    requestId: requestId(), scope: { kind: 'installation' }, name: 'Legacy Org', slug: 'legacy' } });
  const organization = store.execute({ kind: 'namespace', command: original });
  store.execute({ kind: 'namespace', command: command({ kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3), request: {
    requestId: requestId(), scope: { kind: 'organization', organizationId: uuid(1) }, name: 'Legacy Workspace' } }) });
  store.execute({ kind: 'suite', command: suiteCommand({ kind: 'createSuite', id: uuid(50), request: { scope, requestId: requestId(), name: 'Legacy Suite' } }) });
  const pin = { id: uuid(90), sha256: 'a'.repeat(64), bytes: 12 };
  db.prepare('INSERT INTO input_blobs VALUES(?,?,?,?,?,?)').run(pin.id, scope.organizationId, scope.workspaceId, pin.sha256, pin.bytes, 'published');
  db.prepare('INSERT INTO input_blobs VALUES(?,?,?,?,?,?)').run(uuid(91), scope.organizationId, scope.workspaceId, 'b'.repeat(64), 7, 'staging');
  const config = JSON.stringify(request().config); const manifest = JSON.stringify([pin]);
  const revision = db.prepare('INSERT INTO suite_revisions VALUES(?,?,?,?,?,?,?,?)');
  for (let n = 1; n <= count; n++) revision.run(uuid(1000 + n), uuid(50), scope.organizationId, scope.workspaceId, n, 'c'.repeat(64), config, manifest);
  db.prepare('UPDATE suites SET current_revision_id=?,version=2 WHERE id=?').run(uuid(1000 + count), uuid(50));
  return { db, original, organization, pin, config, manifest };
}
