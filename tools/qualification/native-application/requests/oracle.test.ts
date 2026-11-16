import {expect, it} from 'vitest';
import {once} from 'node:events';
import {createHash} from 'node:crypto';
import {createTarget} from './server.js';
import {configuration, contents} from './config.js';
it('validates finite positive and malformed fixtures against the actual engine schema', () => {
 const ref = (name: keyof typeof contents, index: number) => ({id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`, sha256: createHash('sha256').update(contents[name]).digest('hex'), bytes: Buffer.byteLength(contents[name])});
 const refs = {json: ref('json', 1), csv: ref('csv', 2), body: ref('body', 3)};
 expect(configuration(refs).requests).toHaveLength(5); expect(configuration(refs, true).requests).toHaveLength(1);
});
it('independently rejects mixed dataset rows and oversized bodies while accepting a coherent request', async () => {
 const server = createTarget(); server.listen(0, '127.0.0.1'); await once(server, 'listening');
 try {
  const address = server.address(); if (!address || typeof address === 'string') throw Error('Missing owned target address');
  const origin = `http://127.0.0.1:${address.port}`;
  const query = new URLSearchParams({identity: '1', inlineToken: 'A', jsonUser: 'J1', jsonToken: 'JT1', csvName: 'one,first', csvToken: 'a"b', n: '1'});
  const headers = {'X-Identity': '1', 'X-Inline-User': 'one', 'X-Inline-Token': 'A', 'X-Json-User': 'J1', 'X-Json-Token': 'JT1', 'X-Csv-Token': 'a"b', 'X-Number': '1'};
  const send = async (path: string, options: RequestInit = {}) => {const response = await fetch(origin + path, {...options, signal: AbortSignal.timeout(3000)}); await response.text(); return response.status;};
  expect(await send('/native/get/one?' + query, {headers})).toBe(200);
  query.set('csvToken', 't2'); expect(await send('/native/get/one?' + query, {headers})).toBe(500);
  query.set('csvToken', 'a"b'); query.set('identity', '2'); query.set('jsonUser', 'J2'); query.set('jsonToken', 'JT2'); query.set('n', '3'); expect(await send('/native/put/one?' + query, {method: 'PUT', headers: {...headers, 'X-Identity': '2', 'X-Json-User': 'J2', 'X-Json-Token': 'JT2', 'X-Number': '3', 'Content-Type': 'text/plain'}, body: 'x'.repeat(8193)})).toBe(500);
  const counts = await fetch(origin + '/counts').then(response => response.json()) as {rejected: number}; expect(counts.rejected).toBe(2);
 } finally {server.closeAllConnections(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));}
});
