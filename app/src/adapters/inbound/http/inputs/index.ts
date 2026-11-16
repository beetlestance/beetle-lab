import type { FastifyInstance } from 'fastify';
import type { InputHttp, InputRouteOptions } from './types.js';
import { RequestLifetimes } from './lifetime.js';
import { routeParams, chunkOffset, noQuery } from './validation.js';
import { uploadHeaders, contentHeaders } from './headers.js';
import { registerJson } from './json.js';
import { registerUpload } from './upload.js';
import { registerContent } from './content.js';
export type { InputHttp, InputRouteOptions } from './types.js';

/** Requires shipped schema compilers and the actual local-session guard. */
export function registerInputRoutes(server: FastifyInstance, options: InputRouteOptions): InputHttp {
  if (typeof options.authorize !== 'function' || typeof options.newId !== 'function' || !options.inputs) {
    throw new TypeError('Input route dependencies required');
  }
  const owners = new RequestLifetimes();
  server.register(async scoped => {
    owners.register(scoped);
    scoped.addHook('onRequest', options.authorize);
    scoped.addHook('onRequest', async request => {
      routeParams(request);
      const url = request.routeOptions.url ?? '';
      if (url.endsWith('/chunks')) { chunkOffset(request); uploadHeaders(request); }
      else if (url.endsWith('/content')) { noQuery(request); contentHeaders(request); }
      else if (!(request.method === 'GET' && url.endsWith('/inputs'))) noQuery(request);
    });
    registerJson(scoped, options, owners);
    registerUpload(scoped, options, owners);
    registerContent(scoped, options, owners);
  });
  return Object.freeze({ close: () => owners.close() });
}
