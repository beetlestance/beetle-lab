import type { FastifyInstance, onRequestAsyncHookHandler } from 'fastify';
import type { RunLiveMetricsService, RunLiveMetricValue } from '../../../../ports/run-live-metrics.js';
import { registerApiOperation } from '../api-route.js';
import { ApiFault } from '../api-errors.js';
import { RequestLifetimes } from '../request-lifetimes/index.js';
export function registerRunLiveMetricRoutes(
  server: FastifyInstance,
  options: { service: RunLiveMetricsService; authorize: onRequestAsyncHookHandler },
): { close(): Promise<void> } {
  const owners = new RequestLifetimes(2, 5000);
  const freshness = new WeakMap<AbortSignal, RunLiveMetricValue>();
  server.register(async (routes) => {
    routes.addHook('onRequest', options.authorize);
    owners.register(routes);
    routes.addHook('onRequest', async (request, reply) => {
      const length = request.headers['content-length'];
      if (
        Object.keys(request.query as object).length ||
        request.headers['transfer-encoding'] !== undefined ||
        (length !== undefined && length !== '0')
      )
        throw new ApiFault('malformed_request');
      reply.header('Cache-Control', 'no-store');
    });
    routes.addHook('onSend', async (request, reply, payload) => {
      if (reply.statusCode !== 200) return payload;
      const remaining = remainingBudget(freshness.get(owners.forRequest(request).signal), performance.now());
      reply.header('X-Beetle-Live-Fresh-For-Ms', String(remaining));
      return payload;
    });
    registerApiOperation(
      routes,
      'getRunLiveMetrics',
      async ({ params, signal }) => {
        const owner = owners.forSignal(signal);
        const value = await owner.run(() =>
          options.service.reader.getRunLiveMetrics(
            {
              id: params.runId.toLowerCase(),
              scope: {
                kind: 'workspace',
                organizationId: params.organizationId.toLowerCase(),
                workspaceId: params.workspaceId.toLowerCase(),
              },
              attemptId: params.attemptId.toLowerCase(),
            },
            owner,
          ),
        );
        freshness.set(owner.signal, value);
        return value.frame;
      },
      { signalFor: (request) => owners.forRequest(request).signal },
    );
  });
  let closing: Promise<void> | undefined;
  return Object.freeze({
    close() {
      const requests = owners.close();
      const service = options.service.close();
      closing ??= Promise.all([requests, service]).then(() => undefined);
      return closing;
    },
  });
}

function remainingBudget(value: RunLiveMetricValue | undefined, now: number): number {
  if (!value) throw new ApiFault('capacity_unavailable');
  const remaining = Math.floor(value.freshUntilMonotonicMs - now);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(value.observedMonotonicMs) ||
    value.observedMonotonicMs < 0 ||
    now < value.observedMonotonicMs ||
    !Number.isSafeInteger(remaining) ||
    remaining <= 0 ||
    remaining > 6000
  )
    throw new ApiFault('capacity_unavailable');
  return remaining;
}
