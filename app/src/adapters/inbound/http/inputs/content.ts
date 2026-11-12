import type { FastifyInstance } from 'fastify';
import {INPUT_CONTENT_ROUTE} from '@beetle/contracts/api';
import { apiErrorResponse } from '../api-errors.js';
import { header } from './headers.js';
import type { RequestLifetimes } from './lifetime.js';
import type { InputRouteOptions } from './types.js';
import { routeKey } from './validation.js';
import { selectRange } from './ranges.js';
import { beginContent, checkedRecord, writeContent } from './response.js';

export function registerContent(server: FastifyInstance, options: InputRouteOptions, owners: RequestLifetimes): void {
  server.route({ method: 'GET', url: INPUT_CONTENT_ROUTE, exposeHeadRoute: false,
    handler: async (request, reply) => {
      const owner = owners.forRequest(request); const key = routeKey(request);
      const record = checkedRecord(await owner.run(() => options.inputs.get(key)));
      const ifRange = header(request, 'if-range');
      const range = selectRange(ifRange === undefined || ifRange === `"${record.sha256}"`
        ? header(request, 'range') : undefined, record.bytes);
      if (range === false) {
        const { body } = apiErrorResponse('invalid_value');
        return reply.header('Content-Range', `bytes */${record.bytes}`).code(416).send(body);
      }
      let started = false;
      try {
        await owner.run(() => options.inputs.read(key, range, { write: async chunk => {
          owner.check();
          if (!started) { beginContent(reply, record, range); started = true; }
          await writeContent(reply, chunk, owner.signal);
        } }, { signal: owner.signal }));
        owner.check();
        if (!started) beginContent(reply, record, range);
        reply.raw.end();
        return reply;
      } catch (error) {
        if (started) { reply.raw.destroy(); return reply; }
        throw error;
      }
    },
  });
}
