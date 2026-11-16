import type { FastifyInstance, FastifyRequest } from 'fastify';
import { encodeJson } from '@beetle/contracts';
import { API_MAXIMUM_JSON_BYTES, apiMessageSchemas, apiOperations } from '@beetle/contracts/api';
import type { ApiOperation, ApiOperationInput, ApiTypes } from '@beetle/contracts/api';
import { decodePageQuery, decodeMetricSamplesQuery, decodeRunListQuery } from './page-query.js';
import { ResponseContractError } from './schema-compilers.js';
import { ApiFault } from './api-errors.js';

type NamedOperation<N extends ApiOperation['name']> = Extract<ApiOperation, { name: N }>;
type OperationInputs = { [O in ApiOperation as O['name']]: ApiOperationInput<O> };
type OperationReplies = { [O in ApiOperation as O['name']]: ApiTypes[O['response']] };
export type ApiHandler<N extends ApiOperation['name']> = (
  input: OperationInputs[N],
) => Promise<OperationReplies[N]>;
export interface ApiRouteOptions {
  bodyLimit?: number;
  /** Transport-owned lifetime; normal request-body completion is not cancellation. */
  signalFor?: (request: FastifyRequest) => AbortSignal;
}

function input<N extends ApiOperation['name']>(operation: NamedOperation<N>, request: FastifyRequest,
  signalFor: ApiRouteOptions['signalFor']): OperationInputs[N] {
  const signal = signalFor?.(request);
  if (signal !== undefined && !(signal instanceof AbortSignal)) throw new Error('Invalid operation signal');
  return {
    ...('params' in operation ? { params: request.params } : {}),
    ...('query' in operation ? { query: request.query } : {}),
    ...('request' in operation ? { body: request.body } : {}),
    ...(signal === undefined ? {} : { signal }),
  } as OperationInputs[N];
}
function bodyLimit(operation: ApiOperation, requested: number | undefined): number | undefined {
  if (requested !== undefined && (!Number.isSafeInteger(requested) || requested < 1 || requested > API_MAXIMUM_JSON_BYTES)) {
    throw new RangeError('Invalid operation body limit');
  }
  return requested ?? (operation.name === 'createSuiteRevision' ? API_MAXIMUM_JSON_BYTES : undefined);
}

/** Snapshot before Fastify can choose its string/buffer/stream serializer bypass. */
function jsonObject(value: unknown): object {
  try {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new ResponseContractError();
    return JSON.parse(encodeJson(value, API_MAXIMUM_JSON_BYTES)) as object;
  } catch { throw new ResponseContractError(); }
}

/** Register only shipped operations, after compiler and authentication setup.
 * Handlers receive validated DTOs, never a reply or transport response object.
 * Artifact/SSE byte routes have a separate bounded transfer owner.
 */
export function registerApiOperation<N extends ApiOperation['name']>(
  server: FastifyInstance, name: N, handler: ApiHandler<N>, options: ApiRouteOptions = {},
): void {
  const operation = apiOperations.find(candidate => candidate.name === name) as NamedOperation<N> | undefined;
  if (!operation) throw new Error('Unknown API operation');
  if(operation.implementation!=='implemented')throw new Error('API operation is planned, not implemented');
  const limit = bodyLimit(operation, options.bodyLimit); const signalFor = options.signalFor;
  server.route({
    method: operation.method,
    url: operation.path.replace(/\{([A-Za-z]+)\}/g, ':$1'),
    ...(limit === undefined ? {} : { bodyLimit: limit }),
    schema: {
      ...('params' in operation ? { params: apiMessageSchemas[operation.params] } : {}),
      ...('query' in operation ? { querystring: apiMessageSchemas[operation.query] } : {}),
      ...('request' in operation ? { body: apiMessageSchemas[operation.request] } : {}),
      response: { [operation.successStatus]: apiMessageSchemas[operation.response] },
    },
    preValidation: async request => {
      if ('query' in operation) {
        const decoded = operation.query === 'RunMetricSamplesQuery'
          ? decodeMetricSamplesQuery(request.query) : operation.query === 'RunListQuery'
            ? decodeRunListQuery(request.query) : decodePageQuery(request.query);
        if (!decoded.ok) throw new ApiFault('malformed_request');
        request.query = decoded.value;
      }
    },
    handler: async (request, reply) => {
      const result = jsonObject(await handler(input(operation, request, signalFor)));
      return reply.code(operation.successStatus).send(result);
    },
  });
}
