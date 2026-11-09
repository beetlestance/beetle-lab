import { request } from 'node:http';
import type { ClientRequest, IncomingMessage } from 'node:http';
import type { AddressInfo } from 'node:net';
import type { App } from './fixture.js';
import { deferred } from './fixture.js';

export async function listen(app: App): Promise<number> {
  await app.server.listen({ host: '127.0.0.1', port: 0 });
  return (app.server.server.address() as AddressInfo).port;
}
export function peer(app: App, port: number, path: string, expectedBytes: number,
  options: { headers?: Record<string, string>; method?: string } = {}) {
  const received = deferred<IncomingMessage>(); const allBytes = deferred<void>(); const closed = deferred<void>();
  const chunks: Buffer[] = []; let bytes = 0; let response: IncomingMessage | undefined; let ended = false;
  const req = request({ host: '127.0.0.1', port, path, method: options.method ?? 'GET', agent: false,
    headers: { ...app.headers, ...options.headers } }, res => {
    response = res; received.resolve(res);
    res.on('data', (chunk: Buffer) => {
      bytes += chunk.byteLength;
      if (bytes > 1_048_576) { res.destroy(new Error('Synthetic peer bound exceeded')); return; }
      chunks.push(chunk); if (bytes >= expectedBytes) allBytes.resolve();
    });
    res.once('end', () => { ended = true; });
    res.once('error', () => undefined);
    res.once('close', () => closed.resolve());
  });
  req.once('error', () => closed.resolve());
  return { req, received: received.promise, allBytes: allBytes.promise, closed: closed.promise,
    response: () => response, ended: () => ended, bytes: () => bytes, body: () => Buffer.concat(chunks) };
}
export function discardErrors(req: ClientRequest): void { req.on('error', () => undefined); }
