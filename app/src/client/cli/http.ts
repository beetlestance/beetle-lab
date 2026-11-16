import { request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { Readable } from 'node:stream';
import type { IncomingMessage } from 'node:http';
function reply(message: IncomingMessage): Response {
  if (message.rawHeaders.length > 256) {message.destroy(); throw new Error('headers_limit');}
  const headers = new Headers();
  for (let index = 0; index < message.rawHeaders.length; index += 2) headers.append(message.rawHeaders[index]!, message.rawHeaders[index + 1]!);
  const stream = Readable.toWeb(message, {strategy: {highWaterMark: 65536, size: (chunk: Uint8Array) => chunk.byteLength}});
  return new Response(stream as ReadableStream<Uint8Array>, {status: message.statusCode!, headers});
}
function body(value: unknown): string | undefined {
  if (value === undefined) return;
  if (typeof value !== 'string' || Buffer.byteLength(value) > 4096) throw new Error('request_body');
  return value;
}
/** Closed generated-client adapter: preserves configured Host, no redirects/retries. */
export const nodeFetch: typeof fetch = async (input, init) => {
  if (!(input instanceof URL) || !init || !['GET', 'POST'].includes(init.method ?? '') || init.redirect !== 'error') throw new Error('request_shape');
  const payload = body(init.body);
  if (!['http:', 'https:'].includes(input.protocol) || init.signal?.aborted) throw new Error('request_unavailable');
  const send = input.protocol === 'https:' ? httpsRequest : httpRequest;
  return new Promise<Response>((resolve, reject) => {
    const outgoing = send(input, {method: init.method, headers: Object.fromEntries(new Headers(init.headers)),
      maxHeaderSize: 16384, ...(init.signal ? {signal: init.signal} : {})}, incoming => {
      try {resolve(reply(incoming));} catch {incoming.destroy(); reject(new Error('response_shape'));}
    });
    outgoing.once('error', () => reject(new Error('request_failed')));
    outgoing.once('upgrade', (_response, socket) => {socket.destroy(); reject(new Error('response_upgrade'));});
    outgoing.end(payload);
  });
};
