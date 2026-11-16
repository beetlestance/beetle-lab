import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { once } from 'node:events';
import type { LoadedAgentConfiguration, RunnerAttemptIdentity } from '../../src/ports/runner.js';
import type { Ack, Cancellation, Offer } from '@beetle/contracts';

export function fixture<T>(name: string): T {
  return JSON.parse(readFileSync(new URL(`../../../contracts/fixtures/valid/${name}.json`, import.meta.url), 'utf8')) as T;
}
export const identity: RunnerAttemptIdentity = {
  journalAuthority: '33333333-3333-4333-8333-333333333333',
  organizationId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  attemptId: '00000000-0000-4000-8000-000000000003', generation: 1, intentDigest: 'a'.repeat(64),
};
export const otherId = '00000000-0000-4000-8000-000000000099';
export const offer = () => fixture<Offer>('offer');
export const cancellation = () => fixture<Cancellation>('cancel');
export const ack = () => fixture<Ack>('ack');
export function loaded(origin = 'http://runner.invalid'): LoadedAgentConfiguration {
  return { token: 'synthetic_'.padEnd(43, 'x'), configuration: { version: 1, origin,
    tokenFile: '/synthetic/token', expectedInstallationId: '00000000-0000-4000-8000-000000000010',
    profiles: [], storageAllocationBytes: 10000, freeSpaceReserveBytes: 100 } };
}

export async function loopback(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Missing test port');
  return { loaded: loaded(`http://127.0.0.1:${address.port}`),
    close: async () => { server.closeAllConnections(); server.close(); await once(server, 'close'); } };
}

export function send(response: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value);
  response.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) });
  response.end(body);
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export async function turns(): Promise<void> { await new Promise<void>(resolve => setImmediate(resolve)); }
