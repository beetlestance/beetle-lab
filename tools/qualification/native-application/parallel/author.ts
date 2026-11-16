import {randomUUID} from 'node:crypto';
import type {ApiClient} from '@beetle/contracts/api';
import {value} from '../public-api.js';
import {configuration} from '../../resources/lifecycle/configuration.js';
export async function author(api: ApiClient, key: 'shared' | 'pervu' | 'arrival') {
 const organization = value(await api.createOrganization({body: {scope: {kind: 'installation'}, requestId: randomUUID(), name: key, slug: key}}));
 const workspace = value(await api.createWorkspace({params: {organizationId: organization.id}, body: {scope: {kind: 'organization', organizationId: organization.id}, requestId: randomUUID(), name: key}}));
 const params = {organizationId: organization.id, workspaceId: workspace.id}; const scope = {kind: 'workspace' as const, ...params};
 const suite = value(await api.createSuite({params, body: {scope, requestId: randomUUID(), name: key}}));
 const config = await configuration(); config.requests = [{id: 'get', name: key, method: 'GET', path: '/' + key, query: {}, headers: {}, assertions: [{id: 'ok', kind: 'statusEq', value: 200, required: true}]}];
 const revision = value(await api.createSuiteRevision({params: {...params, suiteId: suite.id}, body: {scope, requestId: randomUUID(), expectedVersion: suite.version, engineId: 'k6', configVersion: 1, config}}));
 return {params, scope, revision};
}
