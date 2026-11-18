import Fastify from 'fastify';
import { expect, it } from 'vitest';
import { apiOperations } from '@beetle/contracts/api';
import { protectUpgrade, upgradeFenced, upgradeFenceExchanges } from '../../src/bootstrap/upgrade-fence.js';

const operation = (name: string) => apiOperations.find((item) => item.name === name)!;
function concrete(path: string): string {
  return path.replace(/:[A-Za-z]+/g, '00000000-0000-4000-8000-000000000001');
}

it('reads the fence only from a valid selector field', () => {
  expect(upgradeFenced({ phase: 'ready' })).toBe(false);
  expect(upgradeFenced(null)).toBe(false);
  expect(upgradeFenced({ upgradeFence: '00000000-0000-4000-8000-000000000001' })).toBe(true);
  expect(() => upgradeFenced({ upgradeFence: 'not-a-uuid' })).toThrow('Invalid upgrade fence');
  expect(() => upgradeFenced({ upgradeFence: 7 })).toThrow('Invalid upgrade fence');
});

it('refuses new work with a retryable 503 while reads, cancellation and previews pass', async () => {
  const server = Fastify();
  server.setErrorHandler((error: { statusCode?: number; code?: string }, _request, reply) => {
    void reply.code(error.statusCode ?? 500).send({ code: error.code });
  });
  protectUpgrade(server);
  const names = ['createRun', 'cancelRun', 'listRuns', 'previewRunDeletion', 'pairBrowserSession'];
  for (const name of names) {
    const { method, path } = operation(name);
    server.route({ method, url: path, handler: async () => ({ ok: true }) });
  }
  await server.ready();
  try {
    const call = async (name: string) => {
      const { method, path } = operation(name);
      const url = concrete(path);
      return method === 'GET' ? server.inject({ method, url }) : server.inject({ method, url, payload: {} });
    };
    const refused = await call('createRun');
    expect(refused.statusCode).toBe(503);
    expect(refused.json()).toEqual({ code: 'capacity_unavailable' });
    for (const name of ['cancelRun', 'listRuns', 'previewRunDeletion', 'pairBrowserSession'])
      expect((await call(name)).statusCode, name).toBe(200);
  } finally {
    await server.close();
  }
});

it('permits only named exchanges that exist in the contract', () => {
  const key = (name: string) => `${operation(name).method} ${operation(name).path}`;
  expect(upgradeFenceExchanges.size).toBe(10);
  expect(upgradeFenceExchanges.has(key('cancelRun'))).toBe(true);
  expect(upgradeFenceExchanges.has(key('createRun'))).toBe(false);
});
