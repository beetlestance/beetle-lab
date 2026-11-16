import {initialize} from '../../src/adapters/outbound/sqlite/schema.js';
import {Store} from '../../src/adapters/outbound/sqlite/store.js';
import {prepareNamespaceDeletion} from '../../src/application/namespace-deletion/index.js';
import {command, digest, requestId, scope, uuid, settingsFixture, observation} from './fixture.js';
export function workspaceFixture() {
 const db = initialize(':memory:'); const settings = settingsFixture();
 const store = new Store(db, {installation: settings.chain.installation, runtime: observation()});
 const organization = command({kind: 'createOrganization', id: uuid(1), request: {scope: {kind: 'installation'}, requestId: requestId(), name: 'Owner', slug: 'owner'}});
 const workspace = command({kind: 'createWorkspace', id: uuid(2), rootFolderId: uuid(3), request: {scope: {kind: 'organization', organizationId: uuid(1)}, requestId: requestId(), name: 'Reusable'}});
 store.execute({kind: 'namespace', command: organization}); store.execute({kind: 'namespace', command: workspace});
 const deletion = () => prepareNamespaceDeletion({kind: 'workspace', id: uuid(2), request: {scope: workspace.request.scope, requestId: requestId(), expectedVersion: 1}}, digest);
 return {db, store, workspace, scope, deletion};
}
