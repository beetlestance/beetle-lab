import type { FastifyInstance } from 'fastify';
import { discoverInputColumns } from '../../../../application/inputs/columns.js';
import { registerApiOperation } from '../api-route.js';
import type { ApiRouteOptions } from '../api-route.js';
import type { InputRouteOptions } from './types.js';
import type { RequestLifetimes } from './lifetime.js';
import { scope } from './validation.js';

export function registerInputColumns(
  server: FastifyInstance,
  options: InputRouteOptions,
  owners: RequestLifetimes,
  routeOptions: ApiRouteOptions,
): void {
  registerApiOperation(
    server,
    'getInputColumns',
    async ({ params, query, signal }) => {
      const owner = owners.forSignal(signal);
      return owner.run(() =>
        discoverInputColumns(options.inputs, { scope: scope(params), id: params.inputId }, query.kind, owner.signal),
      );
    },
    routeOptions,
  );
}
