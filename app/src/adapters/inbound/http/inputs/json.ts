import type { FastifyInstance } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import type { InputReceipt, WorkspaceScope } from '@beetle/contracts/api';
import { requireRule, sameScope } from '../../../../domain/namespaces/index.js';
import type { InputControl, InputPage } from '../../../../ports/inputs.js';
import { registerApiOperation } from '../api-route.js';
import { ResponseContractError } from '../schema-compilers.js';
import type { RequestLifetimes } from './lifetime.js';
import type { InputRouteOptions } from './types.js';
import { scope } from './validation.js';
import { checkedRecord } from './response.js';

function matchScope(route: WorkspaceScope, body: WorkspaceScope): void {
  requireRule(sameScope(route, body), 'not_found');
}
function pageSnapshot(value: InputPage): InputPage {
  try { return JSON.parse(encodeJson(value, 1_048_576)) as InputPage; }
  catch { throw new ResponseContractError(); }
}
export function registerJson(server: FastifyInstance, options: InputRouteOptions, owners: RequestLifetimes): void {
  const routeOptions = { bodyLimit: 65_536,
    signalFor: (request: Parameters<RequestLifetimes['forRequest']>[0]) => owners.forRequest(request).signal };
  async function control(command: InputControl, signal: AbortSignal | undefined) {
    const owner = owners.forSignal(signal);
    return owner.run(() => options.inputs.control(command, { signal: owner.signal }));
  }
  registerApiOperation(server, 'createInput', async ({ params, body, signal }) => {
    matchScope(scope(params), body.scope);
    const result = await control({ kind: 'createInput', id: options.newId(), request: body }, signal);
    if (!('state' in result)) throw new ResponseContractError();
    return checkedRecord(result);
  }, routeOptions);
  registerApiOperation(server, 'listInputs', async ({ params, query, signal }) => {
    const owner = owners.forSignal(signal); const routeScope = scope(params);
    const result = await owner.run(() => options.inputs.list({ scope: routeScope, ...query }));
    return { ...pageSnapshot(result), scope: routeScope };
  }, routeOptions);
  registerApiOperation(server, 'getInput', async ({ params, signal }) => {
    const owner = owners.forSignal(signal);
    return checkedRecord(await owner.run(() => options.inputs.get({ scope: scope(params), id: params.inputId })));
  }, routeOptions);
  const transition = async (command: InputControl, signal: AbortSignal | undefined): Promise<InputReceipt> => {
    const result = await control(command, signal);
    if (!('acceptedVersion' in result)) throw new ResponseContractError();
    return result;
  };
  registerApiOperation(server, 'sealInput', async ({ params, body, signal }) => {
    matchScope(scope(params), body.scope);
    return transition({ kind: 'sealInput', id: params.inputId, request: body }, signal);
  }, routeOptions);
  registerApiOperation(server, 'deleteInput', async ({ params, body, signal }) => {
    matchScope(scope(params), body.scope);
    return transition({ kind: 'deleteInput', id: params.inputId, request: body }, signal);
  }, routeOptions);
}
