import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { probeListener as probe } from '../../src/bootstrap/health-probe.js';
import { listener } from '../../src/bootstrap/configuration.js';
it.each(['127.0.0.1', '0.0.0.0', '::1'])(`backend probes its actual listener %s and nondefault port`, async (host) => {
  let status = 200;
  const server = createServer((request, response) => {
    expect(request.method).toBe('HEAD');
    expect(request.url).toBe('/healthz');
    expect(request.headers.authorization).toBeUndefined();
    response.writeHead(status).end();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, host, resolve);
  });
  try {
    const address = server.address();
    if (!address || typeof address === 'string') throw Error('Missing listener');
    expect(await probe({ host, port: address.port }, AbortSignal.timeout(1000))).toBe(true);
    status = 503;
    expect(await probe({ host, port: address.port }, AbortSignal.timeout(1000))).toBe(false);
    expect(await probe({ host, port: address.port }, AbortSignal.abort())).toBe(false);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  }
});
it('backend probe and startup share validated listener settings', () => {
  expect(listener({ BEETLE_LISTEN_HOST: '::1', BEETLE_LISTEN_PORT: '4711' })).toEqual({ host: '::1', port: 4711 });
  expect(() => listener({ BEETLE_LISTEN_HOST: 'example.invalid' })).toThrow();
});
