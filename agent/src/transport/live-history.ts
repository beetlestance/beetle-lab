import { createHash } from 'node:crypto';
import { encodeLiveMetricHistory } from '@beetle/contracts/api';
import type { LiveMetricScope } from '@beetle/contracts/api';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { RequestIdentity } from './request-identity.js';
import type { RequestWork } from './work.js';
import { AgentHttpError } from './types.js';
import type { AgentHttpOptions } from './types.js';
const path = '/runner/v1/attempts/:attemptId/live-history';
export function historyRoute(request: FastifyRequest): boolean {
  return request.routeOptions.url === path;
}
export function registerLiveHistory(
  server: FastifyInstance,
  options: { identity: RequestIdentity; operations: RequestWork; read: AgentHttpOptions['liveHistory'] },
): void {
  server.get(
    path,
    {
      onRequest: async (request) => {
        const length = request.headers['content-length'];
        if (request.headers['transfer-encoding'] !== undefined || (length !== undefined && length !== '0'))
          throw new AgentHttpError(400, 'invalid_protocol');
      },
    },
    async (request, reply) => {
      const scope = options.identity.key(request);
      const bytes = await options.operations.liveHistory(request, async (budget) => {
        if (!options.read) throw new AgentHttpError(503, 'execution_lost', 'transport');
        const value = await options.read(scope, budget);
        if (!value.ok)
          throw new AgentHttpError(
            value.reason === 'busy' ? 429 : 503,
            value.reason === 'busy' ? 'budget_unavailable' : 'execution_lost',
            'transport',
          );
        return encodeReply(value.value, scope);
      });
      reply.header('Cache-Control', 'no-store').type('application/json').send(Buffer.from(bytes));
      return reply;
    },
  );
}
function encodeReply(input: unknown, scope: LiveMetricScope): Uint8Array {
  try {
    const hash = (text: string) => createHash('sha256').update(text).digest('hex');
    return encodeLiveMetricHistory(input, hash, scope);
  } catch {
    throw new AgentHttpError(503, 'execution_lost', 'transport');
  }
}
