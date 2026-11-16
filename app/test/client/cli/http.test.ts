import { createServer } from 'node:http';
import { expect, it } from 'vitest';
import { nodeFetch } from '../../../src/client/cli/http.js';
it('preserves explicit authority, refuses redirects, and aborts an open response body', async () => {
  const paths: string[] = []; const hosts: string[] = [];
  const server = createServer((request, response) => {
    paths.push(request.url!); hosts.push(request.headers.host!);
    if (request.url === '/redirect') {response.writeHead(302, {location: '/unexpected'}).end(); return;}
    response.writeHead(200, {'content-type': 'application/json'}); response.write('{');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing synthetic listener');
  const endpoint = `http://127.0.0.1:${address.port}`;
  try {
    const headers = {host: 'localhost:43127'};
    const redirected = await nodeFetch(new URL(endpoint + '/redirect'), {method: 'GET', headers, redirect: 'error'});
    expect(redirected.status).toBe(302); await redirected.body?.cancel(); expect(paths).toEqual(['/redirect']);
    const controller = new AbortController();
    const held = await nodeFetch(new URL(endpoint + '/held'), {method: 'GET', headers, redirect: 'error', signal: controller.signal});
    const reading = held.text(); controller.abort(); await expect(reading).rejects.toThrow();
    expect(hosts).toEqual(['localhost:43127', 'localhost:43127']);
    await expect(nodeFetch(new URL(endpoint + '/unissued'), {method: 'GET', headers, redirect: 'error', signal: controller.signal})).rejects.toThrow('request_unavailable');
    expect(paths).toEqual(['/redirect', '/held']);
  } finally {server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(cause => cause ? reject(cause) : resolve()));}
});
it('refuses unsupported shape/body before network work', async () => {
  await expect(nodeFetch('http://synthetic.invalid', {method: 'GET', redirect: 'error'})).rejects.toThrow('request_shape');
  await expect(nodeFetch(new URL('http://synthetic.invalid'), {method: 'POST', redirect: 'error', body: 'x'.repeat(4097)})).rejects.toThrow('request_body');
});
