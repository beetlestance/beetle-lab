import { SOURCE_CHUNK_REQUEST_BYTES } from '@beetle/contracts/output-source';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { OutputSourceReader } from '../output-transfer/index.js';
import type { AgentHttpOptions } from './types.js';
import { AgentHttpError } from './types.js';
import type { RequestIdentity } from './request-identity.js';
import type { RequestWork } from './work.js';
import { chunkRequest, sendChunk, sendSource } from './source-json.js';
import { readAbsence, sendAbsence } from './absence.js';
import { snapshotBody } from './json.js';

const path = '/runner/v1/attempts/:attemptId/source';
export function sourceRoute(request: FastifyRequest): boolean {
  return request.routeOptions.url === path || request.routeOptions.url === `${path}/chunk`
    || request.routeOptions.url === `${path}/absence`;
}
function reader(outputs: OutputSourceReader | undefined): OutputSourceReader {
  if (!outputs) throw new AgentHttpError(503, 'execution_lost', 'transport');
  return outputs;
}
export function registerSources(server: FastifyInstance, options: {
  readonly outputs: OutputSourceReader | undefined; readonly absences: AgentHttpOptions['absences'];
  readonly journal: AgentHttpOptions['journal']; readonly identity: RequestIdentity; readonly operations: RequestWork;
}): void {
  const { identity, operations } = options;
  const services = { absences: options.absences, journal: options.journal, journalAuthority: identity.journalAuthority };
  const bodyless = { onRequest: async (request: FastifyRequest) => {
    const length = request.headers['content-length'];
    if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0')) {
      throw new AgentHttpError(400, 'invalid_protocol');
    }
  } };
  server.get(path, bodyless, async (request, reply) => {
    const scope = identity.key(request);
    const value = await operations.source(request, async budget => {
      if (options.absences && await readAbsence(services, scope, budget) !== null) throw new AgentHttpError(409, 'source_absent');
      return reader(options.outputs).source(scope, budget);
    });
    sendSource(reply, value, scope, identity.journalAuthority);
    return reply;
  });
  server.get(`${path}/absence`, bodyless, async (request, reply) => {
    const scope = identity.key(request);
    const value = await operations.source(request, async budget => {
      const proof = await readAbsence(services, scope, budget);
      if (proof !== null) return proof;
      snapshotBody(await options.journal.get(scope), scope);
      throw new AgentHttpError(409, 'source_pending', 'transport');
    });
    sendAbsence(reply, value); return reply;
  });
  server.post(`${path}/chunk`, { bodyLimit: SOURCE_CHUNK_REQUEST_BYTES }, async (request, reply) => {
    const scope = identity.key(request); const body = chunkRequest(request.body);
    const value = await operations.source(request, budget => reader(options.outputs).chunk(scope, body, budget));
    sendChunk(reply, value, body);
    return reply;
  });
}
