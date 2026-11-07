import type { FastifyInstance, FastifyRequest } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { apiMessageSchemas, apiOperations } from '@beetle/contracts/api';
import type { ApiOperation, ApiOperationInput, ApiTypes } from '@beetle/contracts/api';
import { decodePageQuery } from './page-query.js';
import { ResponseContractError } from './schema-compilers.js';
import { ApiFault } from './api-errors.js';

type NamedOperation<N extends ApiOperation['name']> = Extract<ApiOperation, { name: N }>;
export type ApiHandler<N extends ApiOperation['name']> = (
  input: ApiOperationInput<NamedOperation<N>>,
) => Promise<ApiTypes[NamedOperation<N>['response']]>;

function input<N extends ApiOperation['name']>(operation: NamedOperation<N>, request: FastifyRequest): ApiOperationInput<NamedOperation<N>> {
  return {
    ...('params' in operation ? { params: request.params } : {}),
    ...('query' in operation ? { query: request.query } : {}),
    ...('request' in operation ? { body: request.body } : {}),
  } as ApiOperationInput<NamedOperation<N>>;
}

/** Snapshot before Fastify can choose its string/buffer/stream serializer bypass. */
function jsonObject(value: unknown): object {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ResponseContractError();
    return JSON.parse(encodeJson(value, 1_048_576)) as object;
  } catch { throw new ResponseContractError(); }
}

/** Register only shipped operations, after compiler and authentication setup.
 * Handlers receive validated DTOs, never a reply or transport response object.
 * Artifact/SSE byte routes have a separate bounded transfer owner.
 */
export function registerApiOperation<N extends ApiOperation['name']>(
  server: FastifyInstance, name: N, handler: ApiHandler<N>,
): void {
  const operation = apiOperations.find(candidate => candidate.name === name) as NamedOperation<N> | undefined;
  if (!operation) throw new Error('Unknown API operation');
  server.route({
    method: operation.method,
    url: operation.path.replace(/\{([A-Za-z]+)\}/g, ':$1'),
    schema: {
      ...('params' in operation ? { params: apiMessageSchemas[operation.params] } : {}),
      ...('query' in operation ? { querystring: apiMessageSchemas[operation.query] } : {}),
      ...('request' in operation ? { body: apiMessageSchemas[operation.request] } : {}),
      response: { [operation.successStatus]: apiMessageSchemas[operation.response] },
    },
    preValidation: async request => {
      if ('query' in operation) {
        const decoded = decodePageQuery(request.query);
        if (!decoded.ok) throw new ApiFault('malformed_request');
        request.query = decoded.value;
      }
    },
    handler: async (request, reply) => {
      const result = jsonObject(await handler(input(operation, request)));
      return reply.code(operation.successStatus).send(result);
    },
  });
}
