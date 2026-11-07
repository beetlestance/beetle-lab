import { apiOperations } from '../generated/operations.js';
import type { ApiOperation } from '../generated/operations.js';
import type { ApiTypes } from '../generated/types.js';
import { createApiHttpTransport } from './http.js';
import type { ApiHttpOptions, ApiTransport } from './http.js';
import { operationPath, prepareInput } from './input.js';
import { requestOwnership, responseOwnership } from './ownership.js';
import type { ApiClient, ApiClientResult } from './types.js';

export { createApiHttpTransport } from './http.js';
export type { ApiHttpOptions, ApiTransport } from './http.js';
export type { ApiClient, ApiClientFailure, ApiClientResult, ApiOperationInput } from './types.js';

async function invoke(operation: ApiOperation, raw: unknown, transport: ApiTransport, maximum: number): Promise<ApiClientResult<ApiTypes[ApiOperation['response']]>> {
  const input = prepareInput(operation, raw, maximum);
  if (!input || !requestOwnership(operation, input)) return { ok: false, error: { kind: 'request' } };
  const result = await transport.json({ method: operation.method, path: operationPath(operation, input),
    response: operation.response, successStatus: operation.successStatus,
    ...('request' in operation ? { request: operation.request, body: input.body } : {}), signal: input.signal });
  if (result.ok && !responseOwnership(operation, input, result.value)) return { ok: false, error: { kind: 'response' } };
  return result;
}

/** Descriptor-built methods snapshot inputs before fetch; mutation outcomes are never retried. */
export function createApiClient(options: ApiHttpOptions): ApiClient {
  const transport = createApiHttpTransport(options);
  const maximum = options.maximumBytes ?? 1_048_576;
  return Object.freeze(Object.fromEntries(apiOperations.map(operation => [operation.name,
    (input: unknown) => invoke(operation, input, transport, maximum)]))) as ApiClient;
}
