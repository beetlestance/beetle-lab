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
