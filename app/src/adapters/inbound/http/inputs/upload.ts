import { Readable } from 'node:stream';
import type { FastifyInstance } from 'fastify';
import { apiMessageSchemas,INPUT_CHUNK_ROUTE } from '@beetle/contracts/api';
import { ApiFault } from '../api-errors.js';
import { ChunkBody } from './body.js';
import type { RequestLifetimes } from './lifetime.js';
import type { InputRouteOptions } from './types.js';
import { chunkOffset, routeKey } from './validation.js';
import { checkedRecord } from './response.js';

export function registerUpload(server: FastifyInstance, options: InputRouteOptions, owners: RequestLifetimes): void {
  server.addContentTypeParser('application/octet-stream', (_request, payload, done) => done(null, payload));
  server.route({ method: 'PUT', url: INPUT_CHUNK_ROUTE,
    schema: { response: { 200: apiMessageSchemas.InputRecord } },
    handler: async (request, reply) => {
      const owner = owners.forRequest(request);
      if (!(request.body instanceof Readable)) throw new ApiFault('malformed_request');
      const body = new ChunkBody(request.body, owner.signal);
      try {
        const record = await owner.run(() => options.inputs.append(routeKey(request), chunkOffset(request),
          () => body.read(), { signal: owner.signal }));
        return reply.code(200).send(checkedRecord(record));
      } catch (error) { throw body.fault ?? error; }
    },
  });
}
