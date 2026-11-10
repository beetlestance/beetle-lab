import { SOURCE_CHUNK_REQUEST_BYTES } from '@beetle/contracts/output-source';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OutputSourceReader } from '../output-transfer/index.js';
import { AgentHttpError } from './types.js';
import type { RequestIdentity } from './request-identity.js';
import type { RequestWork } from './work.js';
import { chunkRequest, sendChunk, sendSource } from './source-json.js';

const path = '/runner/v1/attempts/:attemptId/source';
export function sourceRoute(request: FastifyRequest): boolean {
  return request.routeOptions.url === path || request.routeOptions.url === `${path}/chunk`;
}
function reader(outputs: OutputSourceReader | undefined): OutputSourceReader {
  if (!outputs) throw new AgentHttpError(503, 'execution_lost', 'transport');
  return outputs;
}
export function registerSources(server: FastifyInstance, options: {
  readonly outputs: OutputSourceReader | undefined; readonly identity: RequestIdentity; readonly operations: RequestWork;
}): void {
  const { identity, operations } = options;
  server.get(path, { onRequest: async request => {
    const length = request.headers['content-length'];
    if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
      throw new AgentHttpError(400, 'invalid_protocol');
    }
  } }, async (request, reply) => {
    const scope = identity.key(request);
    const value = await operations.source(request, budget => reader(options.outputs).source(scope, budget));
    sendSource(reply, value, scope, identity.journalAuthority);
    return reply;
  });
  server.post(`${path}/chunk`, { bodyLimit: SOURCE_CHUNK_REQUEST_BYTES }, async (request, reply) => {
    const scope = identity.key(request); const body = chunkRequest(request.body);
    const value = await operations.source(request, budget => reader(options.outputs).chunk(scope, body, budget));
    sendChunk(reply, value, body);
    return reply;
  });
}
