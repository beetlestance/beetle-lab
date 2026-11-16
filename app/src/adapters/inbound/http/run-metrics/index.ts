import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { RunMetricsService } from '../../../../ports/run-metrics.js';
import { registerApiOperation } from '../api-route.js';
import { RequestLifetimes } from '../request-lifetimes/index.js';
interface Options {service: RunMetricsService; authorize: onRequestAsyncHookHandler}
/** JSON routes retain their request lifetime through service and transport work. */
export function registerRunMetricRoutes(server: FastifyInstance, options: Options): {close(): Promise<void>} {
  const owners = new RequestLifetimes(1);
  server.register(async routes => {
    routes.addHook('onRequest', options.authorize); owners.register(routes);
    const scope = (p: {organizationId: string; workspaceId: string}) => ({kind: 'workspace' as const,
      organizationId: p.organizationId.toLowerCase(), workspaceId: p.workspaceId.toLowerCase()});
    registerApiOperation(routes, 'listRunMetricSeries', ({params, query, signal}) => {
      const owner = owners.forSignal(signal);
      return owner.run(() => options.service.reader.listRunMetricSeries({id: params.runId.toLowerCase(), scope: scope(params),
        attemptId: params.attemptId.toLowerCase(), ...query}, owner));
    }, {signalFor: request => owners.forRequest(request).signal});
    registerApiOperation(routes, 'getRunMetricSamples', ({params, query, signal}) => {
      const owner = owners.forSignal(signal);
      return owner.run(() => options.service.reader.getRunMetricSamples({id: params.runId.toLowerCase(), scope: scope(params),
        attemptId: params.attemptId.toLowerCase(), ...query}, owner));
    }, {signalFor: request => owners.forRequest(request).signal});
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({close() { const requests = owners.close(); const service = options.service.close();
    closing ??= Promise.all([requests, service]).then(() => undefined); return closing; }});
}
