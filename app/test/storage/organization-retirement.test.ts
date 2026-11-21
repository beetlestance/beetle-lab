import {expect, it} from 'vitest';
import {workspaceFixture} from './workspace-retirement-fixture.js';
import {command, digest, requestId, uuid} from './fixture.js';
import {prepareNamespaceDeletion} from '../../src/application/namespace-deletion/index.js';
import {classifyMetadataError, explainMetadataError} from '../../src/bootstrap/metadata-errors.js';
import {markHistorical} from '../../src/adapters/outbound/sqlite/historical.js';
const installation = {kind: 'installation'} as const;
const organizationScope = {kind: 'organization', organizationId: uuid(1)} as const;
function organizationDeletion(version = 1) {
 return prepareNamespaceDeletion({kind: 'organization', id: uuid(1), request: {scope: installation, requestId: requestId(), expectedVersion: version}}, digest);
}
function retiredFixture() {
 const f = workspaceFixture(); f.store.execute({kind: 'deleteNamespace', command: f.deletion()});
 return f;
}
it('refuses while any workspace is active, then retires and keeps rows, settings and the canonical slug', () => {
 const f = workspaceFixture(); try {
  let refusal: unknown;
  try {
   f.store.execute({kind: 'deleteNamespace', command: organizationDeletion()});
  } catch (error) {
   refusal = error;
  }
  expect(refusal).toMatchObject({code: 'organization_has_active_workspaces'});
  expect(classifyMetadataError(refusal)).toBe('conflict');
  expect(explainMetadataError(refusal)).toBe('active');
  f.store.execute({kind: 'deleteNamespace', command: f.deletion()});
  const intent = organizationDeletion(); const receipt = f.store.execute({kind: 'deleteNamespace', command: intent});
  expect(receipt).toMatchObject({id: uuid(1), state: 'tombstoned', version: 2});
  expect(f.store.execute({kind: 'deleteNamespace', command: intent})).toEqual(receipt);
  expect(f.db.prepare('SELECT name,slug,retired_slug,retired,version FROM organizations WHERE id=?').get(uuid(1)))
   .toMatchObject({name: 'Owner', slug: '\u0001' + uuid(1), retired_slug: 'owner', retired: 1, version: 1});
  expect(f.db.prepare("SELECT COUNT(*) n FROM settings WHERE organization_id=?").get(uuid(1))?.n).toBe(2);
  expect(f.db.prepare('SELECT COUNT(*) n FROM workspaces WHERE organization_id=?').get(uuid(1))?.n).toBe(1);
  expect(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes).toBe(4096);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
 } finally {f.db.close();}
});
it('hides the retired organisation, fences its scope and lets a new organisation reuse the slug', () => {
 const f = retiredFixture(); try {
  f.store.execute({kind: 'deleteNamespace', command: organizationDeletion()});
  expect(() => f.store.execute({kind: 'get', key: {kind: 'organization', id: uuid(1), scope: installation}})).toThrow('not_found');
  expect(f.store.execute({kind: 'list', query: {kind: 'organization', scope: installation, limit: 10}})).toMatchObject({items: []});
  expect(() => f.store.execute({kind: 'list', query: {kind: 'workspace', scope: organizationScope, limit: 10}})).toThrow('not_found');
  const workspace = command({kind: 'createWorkspace', id: uuid(30), rootFolderId: uuid(31), request: {scope: organizationScope, requestId: requestId(), name: 'Late'}});
  expect(() => f.store.execute({kind: 'namespace', command: workspace})).toThrow('not_found');
  const rename = command({kind: 'patchOrganization', id: uuid(1), request: {scope: installation, requestId: requestId(), expectedVersion: 1, name: 'Again'}});
  expect(() => f.store.execute({kind: 'namespace', command: rename})).toThrow('not_found');
  expect(() => f.store.execute({kind: 'deleteNamespace', command: organizationDeletion()})).toThrow('not_found');
  const next = command({kind: 'createOrganization', id: uuid(40), request: {scope: installation, requestId: requestId(), name: 'Owner', slug: 'owner'}});
  expect(f.store.execute({kind: 'namespace', command: next})).toMatchObject({id: uuid(40), slug: 'owner'});
  expect(f.store.execute({kind: 'list', query: {kind: 'organization', scope: installation, limit: 10}})).toMatchObject({items: [{id: uuid(40)}]});
 } finally {f.db.close();}
});
it('physically deletes an organisation that never had a workspace', () => {
 const f = workspaceFixture(); try {
  const empty = command({kind: 'createOrganization', id: uuid(50), request: {scope: installation, requestId: requestId(), name: 'Empty', slug: 'empty'}});
  f.store.execute({kind: 'namespace', command: empty});
  f.store.execute({kind: 'deleteNamespace', command: prepareNamespaceDeletion({kind: 'organization', id: uuid(50),
   request: {scope: installation, requestId: requestId(), expectedVersion: 1}}, digest)});
  expect(f.db.prepare('SELECT COUNT(*) n FROM organizations WHERE id=?').get(uuid(50))?.n).toBe(0);
  expect(f.db.prepare("SELECT COUNT(*) n FROM settings WHERE organization_id=?").get(uuid(50))?.n).toBe(0);
 } finally {f.db.close();}
});
it('rejects raw retirement, retired-row changes and new children under a retired organisation', () => {
 const f = retiredFixture(); try {
  expect(() => f.db.prepare("UPDATE organizations SET retired=1,retired_slug=slug,slug=char(1)||id WHERE id=?").run(uuid(1))).toThrow('requires marker');
  expect(() => f.db.prepare('INSERT INTO organizations(id,version,name,slug,retired) VALUES(?,1,?,?,1)').run(uuid(60), 'X', 'x')).toThrow('invalid active organization');
  f.store.execute({kind: 'deleteNamespace', command: organizationDeletion()});
  expect(() => f.db.exec("UPDATE organizations SET name='Changed'")).toThrow('retained organization');
  expect(() => f.db.exec('DELETE FROM organizations')).toThrow('retained organization');
  expect(() => f.db.prepare("UPDATE settings SET version=version+1 WHERE kind='organization' AND organization_id=?").run(uuid(1))).toThrow('retained organization settings');
 } finally {f.db.close();}
});
it('keeps a retired organisation readable in historical mode', () => {
 const f = retiredFixture(); try {
  f.store.execute({kind: 'deleteNamespace', command: organizationDeletion()});
  markHistorical(f.db);
  expect(f.store.execute({kind: 'get', key: {kind: 'organization', id: uuid(1), scope: installation}})).toMatchObject({name: 'Owner', slug: 'owner'});
  expect(f.store.execute({kind: 'list', query: {kind: 'organization', scope: installation, limit: 10}})).toMatchObject({items: [{id: uuid(1)}]});
 } finally {f.db.close();}
});
