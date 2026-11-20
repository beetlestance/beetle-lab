import type { FastifyInstance } from 'fastify';
export type StorageStatus = 'ready' | 'closing' | 'unavailable';
/** Private component health, with no database command, authentication or user payload. */
export function registerStorageHealth(server: FastifyInstance, status: () => StorageStatus): void {
  server.get('/healthz', async (_request, reply) => {
    const storage = status();
    return reply
      .header('Cache-Control', 'no-store')
      .code(storage === 'ready' ? 200 : 503)
      .send({ status: storage === 'ready' ? 'ok' : 'unavailable', storage });
  });
}

/**
 * Public readiness for load balancers and the host upgrade tool: no authentication and no
 * installation facts beyond whether this backend takes new work. A fenced backend serves
 * reads but is not ready for new work until the upgrade is activated.
 */
export function registerReadiness(server: FastifyInstance, status: () => StorageStatus, fenced: boolean): void {
  server.get('/health/ready', async (_request, reply) => {
    const storage = status();
    const ready = storage === 'ready' && !fenced;
    const reason = storage !== 'ready' ? storage : fenced ? 'upgrade_pending' : null;
    return reply
      .header('Cache-Control', 'no-store')
      .code(ready ? 200 : 503)
      .send({ status: ready ? 'ready' : 'not_ready', reason });
  });
}
