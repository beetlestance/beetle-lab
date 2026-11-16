import type {onRequestAsyncHookHandler} from 'fastify';
import {apiOperations, validateApi} from '@beetle/contracts/api';
import {ApiFault} from './api-errors.js';
import type {NamespaceReader} from '../../../ports/namespace-reader.js';
const deletionPath = apiOperations.find(operation => operation.name === 'deleteWorkspace')!.path.replace(/\{([A-Za-z]+)\}/g, ':$1');
/** Auth first. An owned read already authorised before retirement may finish normally. */
export function workspaceVisibility(authorize: onRequestAsyncHookHandler, reader: NamespaceReader, historical: boolean): onRequestAsyncHookHandler {
 if (historical) return authorize;
 return async function (request, reply) {
  await authorize.call(this, request, reply); if (reply.sent) return;
  if (request.method === 'DELETE' && request.routeOptions.url === deletionPath) return;
  const params = request.params as Record<string, unknown> | undefined;
  if (!params || typeof params.workspaceId !== 'string') return;
  const input = {organizationId: params.organizationId, workspaceId: params.workspaceId};
  const checked = validateApi('WorkspaceParams', input); if (!checked.ok) throw new ApiFault('malformed_request');
  await reader.get({kind: 'workspace', id: checked.value.workspaceId,
   scope: {kind: 'organization', organizationId: checked.value.organizationId}});
 };
}
