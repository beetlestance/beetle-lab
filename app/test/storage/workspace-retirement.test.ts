import {expect, it} from 'vitest';
import {workspaceFixture} from './workspace-retirement-fixture.js';
import {command, requestId, scope, uuid} from './fixture.js';
import {suiteCommand} from './suites-fixture.js';
import {markHistorical} from '../../src/adapters/outbound/sqlite/historical.js';
import {workspaceBusySql} from '../../src/adapters/outbound/sqlite/workspace-retirement/visibility.js';
it('retains used rows and old CREATE acknowledgements, but fences derived mutation replay and releases the visible name', () => {
 const f = workspaceFixture(); try {
  const folder = command({kind: 'createFolder', id: uuid(4), request: {scope, requestId: requestId(), name: 'Retained', parentFolderId: uuid(3)}});
  const suite = suiteCommand({kind: 'createSuite', id: uuid(5), request: {scope, requestId: requestId(), name: 'Saved'}});
  f.store.execute({kind: 'namespace', command: folder}); f.store.execute({kind: 'suite', command: suite});
  const original = f.store.execute({kind: 'namespace', command: f.workspace}); const intent = f.deletion();
  f.store.execute({kind: 'deleteNamespace', command: intent});
  expect(f.db.prepare('SELECT name,folded_name,retired FROM workspaces WHERE id=?').get(uuid(2))).toMatchObject({name: 'Reusable', folded_name: '\u0001' + uuid(2), retired: 1});
  expect(f.db.prepare('SELECT COUNT(*) n FROM folders WHERE workspace_id=?').get(uuid(2))?.n).toBe(2);
  expect(f.db.prepare('SELECT COUNT(*) n FROM suites WHERE workspace_id=?').get(uuid(2))?.n).toBe(1);
  expect(f.store.execute({kind: 'namespace', command: f.workspace})).toEqual(original);
  expect(() => f.store.execute({kind: 'namespace', command: folder})).toThrow('not_found');
  expect(() => f.store.execute({kind: 'suite', command: suite})).toThrow('not_found');
  const next = command({kind: 'createWorkspace', id: uuid(20), rootFolderId: uuid(21), request: {...f.workspace.request, requestId: requestId()}});
  expect(f.store.execute({kind: 'namespace', command: next})).toMatchObject({id: uuid(20), name: 'Reusable'});
  expect(f.store.execute({kind: 'list', query: {kind: 'workspace', scope: f.workspace.request.scope, limit: 100}})).toMatchObject({items: [{id: uuid(20)}]});
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 } finally {f.db.close();}
});
it('rejects raw flag/key mutation, retired-row removal and child insertion while preserving rollback', () => {
 const f = workspaceFixture(); try {
  expect(() => f.db.prepare('UPDATE workspaces SET retired=1 WHERE id=?').run(uuid(2))).toThrow('requires marker');
  expect(() => f.db.prepare('UPDATE workspaces SET folded_name=char(1)||id WHERE id=?').run(uuid(2))).toThrow('requires marker');
  f.db.exec("CREATE TRIGGER fail_retire AFTER UPDATE OF retired ON workspaces WHEN NEW.retired=1 BEGIN SELECT RAISE(ABORT,'late retirement failure');END");
  expect(() => f.store.execute({kind: 'deleteNamespace', command: f.deletion()})).toThrow('late retirement failure');
  expect(f.db.prepare('SELECT retired,folded_name FROM workspaces WHERE id=?').get(uuid(2))).toMatchObject({retired: 0, folded_name: 'reusable'});
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(0);
  f.db.exec('DROP TRIGGER fail_retire'); f.store.execute({kind: 'deleteNamespace', command: f.deletion()});
  expect(() => f.db.exec('UPDATE workspaces SET retired=0')).toThrow(/retained workspace|requires marker/);
  expect(() => f.db.exec('DELETE FROM workspaces')).toThrow('retained workspace');
  expect(() => f.db.prepare('INSERT INTO folders VALUES(?,?,?,?,1,?,?)').run(uuid(40), uuid(1), uuid(2), uuid(3), 'New', 'new')).toThrow('retired workspace');
 } finally {f.db.close();}
});
it('uses indexed active pagination and preserves separately authorised historical visibility', () => {
 const f = workspaceFixture(); try {
  f.store.execute({kind: 'deleteNamespace', command: f.deletion()});
  expect(() => f.store.execute({kind: 'get', key: {kind: 'workspace', id: uuid(2), scope: f.workspace.request.scope}})).toThrow('not_found');
  const page = 'SELECT id FROM workspaces INDEXED BY workspaces_visible WHERE retired=0 AND organization_id=? AND id>? ORDER BY id LIMIT ?';
  expect(f.db.prepare('EXPLAIN QUERY PLAN ' + page).all(uuid(1), '', 2).some(row => String(row.detail).includes('SCAN'))).toBe(false);
  expect(f.db.prepare('EXPLAIN QUERY PLAN SELECT retired,(' + workspaceBusySql + ') busy FROM workspaces target WHERE target.id=?').all(uuid(2)).every(row => !String(row.detail).includes('SCAN'))).toBe(true);
  markHistorical(f.db);
  expect(f.store.execute({kind: 'get', key: {kind: 'workspace', id: uuid(2), scope: f.workspace.request.scope}})).toMatchObject({name: 'Reusable'});
  expect(f.store.execute({kind: 'list', query: {kind: 'workspace', scope: f.workspace.request.scope, limit: 10}})).toMatchObject({items: [{id: uuid(2)}]});
  expect(() => f.store.execute({kind: 'namespace', command: f.workspace})).toThrow('read_only');
 } finally {f.db.close();}
});
