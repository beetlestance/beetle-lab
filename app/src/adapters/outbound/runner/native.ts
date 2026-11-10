import { lookup } from 'node:dns/promises';
import { request } from 'node:http';
import type { ClientRequest, IncomingMessage, RequestOptions } from 'node:http';
import { isIP } from 'node:net';
import type { Socket } from 'node:net';
import { receiveJson } from './response.js';

interface Address { address: string; family: number }
/** Feature-local seam for controlled original DNS and native close tests. */
export interface NativeIo {
  lookup(hostname: string): Promise<readonly Address[]>;
  request(options: RequestOptions): ClientRequest;
}
export const nativeIo: NativeIo = {
  lookup: hostname => lookup(hostname, { all: true, verbatim: true }),
  request: options => request(options),
};
export interface NativeInput {
  readonly origin: URL;
  readonly path: string;
  readonly method: string;
  readonly headers: Readonly<Record<string, string>>;
  readonly body: string | undefined;
  readonly signal: AbortSignal;
}
export type NativeResult = { ok: true; status: number; value: unknown }
  | { ok: false; kind: 'transport' | 'response' };

function pinnedOptions(input: NativeInput, address: Address): RequestOptions {
  return {
    protocol: 'http:', hostname: address.address, family: address.family,
    port: input.origin.port || 80, path: input.path, method: input.method,
    agent: false, maxHeaderSize: 16_384, insecureHTTPParser: false,
    headers: { ...input.headers, host: input.origin.host, connection: 'close',
      'content-type': 'application/json', 'accept-encoding': 'identity',
      ...(input.body === undefined ? {} : { 'content-length': Buffer.byteLength(input.body).toString() }) },
  };
}

/** No address fallback: even a lost reply to a mutation is never retried. */
export async function nativeCall(input: NativeInput, io: NativeIo): Promise<NativeResult> {
  if (input.signal.aborted) return { ok: false, kind: 'transport' };
  let addresses: readonly Address[];
  try { addresses = await io.lookup(input.origin.hostname.replace(/^\[|\]$/g, '')); }
  catch { return { ok: false, kind: 'transport' }; }
  if (input.signal.aborted || addresses.length < 1 || addresses.length > 8) return { ok: false, kind: 'transport' };
  if (!addresses.every(value => isIP(value.address) === value.family && [4, 6].includes(value.family))) {
    return { ok: false, kind: 'transport' };
  }
  return ownSocket(input, io, addresses[0]!);
}

interface SocketOwner {
  request: ClientRequest;
  socket: Socket | undefined;
  response: IncomingMessage | undefined;
  requestClosed: boolean;
  socketClosed: boolean;
  responseClosed: boolean;
  result: NativeResult;
}

function ownSocket(input: NativeInput, io: NativeIo, address: Address): Promise<NativeResult> {
  return new Promise(resolve => {
    let req: ClientRequest;
    try { req = io.request(pinnedOptions(input, address)); }
    catch { resolve({ ok: false, kind: 'transport' }); return; }
    const owner: SocketOwner = { request: req, socket: undefined, response: undefined,
      requestClosed: false, socketClosed: true, responseClosed: true, result: { ok: false, kind: 'transport' } };
    const finish = () => {
      if (!owner.requestClosed || !owner.socketClosed || !owner.responseClosed) return;
      input.signal.removeEventListener('abort', stop);
      resolve(owner.result);
    };
    const stop = () => { owner.response?.destroy(); req.destroy(); owner.socket?.destroy(); };
    const fail = () => {
      if (!owner.result.ok) owner.result = { ok: false, kind: owner.response ? 'response' : 'transport' };
      stop();
    };
    req.once('socket', socket => {
      owner.socket = socket; owner.socketClosed = socket.closed;
      socket.once('close', () => { owner.socketClosed = true; finish(); });
      if (input.signal.aborted) stop();
    });
    req.once('response', response => ownResponse(owner, response, { finish, fail, stop }));
    req.once('close', () => { owner.requestClosed = true; finish(); });
    req.on('error', fail);
    req.on('information', fail);
    input.signal.addEventListener('abort', stop, { once: true });
    if (input.signal.aborted) stop();
    else {
      try { req.end(input.body); } catch { fail(); }
    }
  });
}

function ownResponse(owner: SocketOwner, response: IncomingMessage,
  callbacks: { finish(): void; fail(): void; stop(): void }): void {
  owner.response = response;
  owner.responseClosed = false;
  owner.result = { ok: false, kind: 'response' };
  response.once('close', () => { owner.responseClosed = true; callbacks.finish(); });
  response.on('error', callbacks.fail);
  response.once('aborted', callbacks.fail);
  receiveJson(response, value => {
    owner.result = { ok: true, status: response.statusCode ?? 0, value };
    callbacks.stop();
  }, callbacks.fail);
}
