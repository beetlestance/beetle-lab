import {expect, it, vi} from 'vitest';
import {createApiServer, ApiFault} from './api-errors.js';
import {workspaceVisibility} from './workspace-visibility.js';
import type {NamespaceReader} from '../../../ports/namespace-reader.js';
const org = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const workspace = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const route = '/api/v2/organizations/:organizationId/workspaces/:workspaceId';
function fixture() {
 const server = createApiServer(); const get = vi.fn<NamespaceReader['get']>(async () => {throw new ApiFault('not_found');});
 const authorize = vi.fn(async (request: {headers: Record<string, unknown>}) => {if (request.headers.denied) throw new ApiFault('forbidden');});
 const access = workspaceVisibility(authorize, {get, list: async () => ({items: [], nextCursor: null})}, false);
 return {server, get, authorize, access};
}
it('authorizes before existence and rejects retired access before body parsing/handler work', async () => {
 const f = fixture(); let parsed = false; const handler = vi.fn(async () => ({ok: true}));
 f.server.addHook('preParsing', async (_request, _reply, payload) => {parsed = true; return payload;});
 f.server.post(route + '/suites', {onRequest: f.access}, handler);
 try {
  const url = `/api/v2/organizations/${org}/workspaces/${workspace}/suites`;
  const denied = await f.server.inject({method: 'POST', url, headers: {denied: '1', 'content-type': 'application/json'}, payload: 'invalid'});
  expect(denied.statusCode).toBe(403); expect(f.get).not.toHaveBeenCalled(); expect(parsed).toBe(false);
  const retired = await f.server.inject({method: 'POST', url, headers: {'content-type': 'application/json'}, payload: 'invalid'});
  expect(retired.statusCode).toBe(404); expect(parsed).toBe(false); expect(handler).not.toHaveBeenCalled();
 } finally {await f.server.close();}
});
it('skips visibility only for the exact registered workspace DELETE identity', async () => {
 const f = fixture(); const ack = {state: 'tombstoned'}; f.server.delete(route, {onRequest: f.access}, async () => ack);
 f.server.delete(route + '/other', {onRequest: f.access}, async () => ack); f.server.get(route, {onRequest: f.access}, async () => ack);
 try {
  const url = `/api/v2/organizations/${org}/workspaces/${workspace}`;
  expect((await f.server.inject({method: 'DELETE', url})).statusCode).toBe(200); expect(f.get).not.toHaveBeenCalled();
  expect((await f.server.inject({method: 'DELETE', url: url + '/other'})).statusCode).toBe(404);
  expect((await f.server.inject({method: 'GET', url})).statusCode).toBe(404); expect(f.authorize).toHaveBeenCalledTimes(3);
 } finally {await f.server.close();}
});
