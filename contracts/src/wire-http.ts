import type { StructuralIssue, ValidationResult } from './validate.js';
import { encodeJson, readJson } from './json.js';

export interface WireFailure<E> {
  readonly kind: 'request' | 'response' | 'transport' | 'cancelled' | 'timeout' | 'protocol';
  readonly status?: number;
  readonly issues?: readonly StructuralIssue[];
  readonly protocol?: E;
}
export type WireResult<T, E> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: WireFailure<E> };
type MessageName<S extends object> = Extract<keyof S, string>;
export interface WireCall<N extends string, R extends string> {
  method: string; path: string; response: N; successStatus: number; request?: R; body?: unknown; signal?: AbortSignal | undefined;
}
export interface WireTransport<S extends object, E> {
  json<N extends MessageName<S>>(call: WireCall<N, MessageName<S>>): Promise<WireResult<S[N], E>>;
}
export interface WireRegistry<S extends object, E> {
  pathPrefix: '/runner/v1/' | '/api/v2/';
  validate<N extends MessageName<S>>(name: N, input: unknown): ValidationResult<S[N]>;
  validateError(input: unknown): ValidationResult<E>;
}
export interface HttpOptions {
  /** Private, trusted application/agent URL. Credentials are injected by the owner. */
  baseUrl: string;
  fetch?: typeof fetch;
  headers?: Readonly<Record<string, string>>;
  maximumBytes?: number;
  timeoutMs?: number;
}
interface ResolvedOptions {
  baseUrl: URL; fetch: typeof fetch; headers: Readonly<Record<string, string>>; maximumBytes: number; timeoutMs: number;
}

function requestBody<S extends object, E>(call: WireCall<MessageName<S>, MessageName<S>>, maximum: number, registry: WireRegistry<S, E>): WireResult<string | undefined, E> {
  if (!call.request) return { ok: true, value: undefined };
  try {
    const body = encodeJson(call.body, maximum);
    const checked = registry.validate(call.request, JSON.parse(body) as unknown);
    if (!checked.ok) return { ok: false, error: { kind: 'request', issues: checked.issues } };
    return { ok: true, value: body };
  } catch { return { ok: false, error: { kind: 'request' } }; }
}
function reply<S extends object, E, N extends MessageName<S>>(response: Response, input: unknown, call: WireCall<N, MessageName<S>>, registry: WireRegistry<S, E>): WireResult<S[N], E> {
  if (!response.ok) {
    const error = registry.validateError(input);
    return error.ok ? { ok: false, error: { kind: 'protocol', status: response.status, protocol: error.value } }
      : { ok: false, error: { kind: 'response', status: response.status, issues: error.issues } };
  }
  if (response.status !== call.successStatus) return { ok: false, error: { kind: 'response', status: response.status } };
  const checked = registry.validate(call.response, input);
  return checked.ok ? checked : { ok: false, error: { kind: 'response', status: response.status, issues: checked.issues } };
}
function requestUrl(base: URL, path: string, prefix: string): URL | undefined {
  if (path.length > 2048 || !path.startsWith(prefix) || path.includes('\\')) return undefined;
  try {
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith(prefix) || url.hash) return undefined;
    return url;
  } catch { return undefined; }
}
function interrupted(signal: AbortSignal, caller: AbortSignal | undefined, fallback: 'transport' | 'response'): WireFailure<never>['kind'] {
  if (caller?.aborted) return 'cancelled';
  return signal.aborted ? 'timeout' : fallback;
}
function fetchReply(fetcher: typeof fetch, url: URL, init: RequestInit, signal: AbortSignal): Promise<Response> {
  return new Promise((resolve, reject) => {
    const abort = () => { signal.removeEventListener('abort', abort); reject(new Error('aborted')); };
    signal.addEventListener('abort', abort, { once: true });
    void Promise.resolve().then(() => fetcher(url, init)).then(response => {
      signal.removeEventListener('abort', abort);
      if (signal.aborted) {
        // A late adapter reply must not retain its body after our deadline.
        try { void response.body?.cancel().catch(() => undefined); } catch { /* best-effort cleanup */ }
        reject(new Error('aborted'));
      } else resolve(response);
    }, error => { signal.removeEventListener('abort', abort); reject(error); });
    if (signal.aborted) abort();
  });
}
async function send<S extends object, E, N extends MessageName<S>>(options: ResolvedOptions, call: WireCall<N, MessageName<S>>, registry: WireRegistry<S, E>): Promise<WireResult<S[N], E>> {
  const url = requestUrl(options.baseUrl, call.path, registry.pathPrefix);
  if (!url) return { ok: false, error: { kind: 'request' } };
  const body = requestBody(call, options.maximumBytes, registry);
  if (!body.ok) return body;
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal = call.signal ? AbortSignal.any([call.signal, deadline]) : deadline;
  let response: Response;
  try {
    response = await fetchReply(options.fetch, url, {
      method: call.method, headers: { ...options.headers, 'content-type': 'application/json' },
      ...(body.value === undefined ? {} : { body: body.value }), signal, redirect: 'error',
    }, signal);
  } catch { return { ok: false, error: { kind: interrupted(signal, call.signal, 'transport') } }; }
  let input: unknown;
  try { input = await readJson(response, options.maximumBytes, signal); }
  catch { return { ok: false, error: { kind: interrupted(signal, call.signal, 'response'), status: response.status } }; }
  return reply(response, input, call, registry);
}
function limit(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name} limit`);
  return value;
}

/** No retries: an execution retry requires explicit new user intent. */
export function createWireTransport<S extends object, E>(options: HttpOptions, registry: WireRegistry<S, E>): WireTransport<S, E> {
  const policy = Object.freeze({ ...registry });
  let baseUrl: URL;
  try { baseUrl = new URL(options.baseUrl); } catch { throw new Error('Invalid service URL'); }
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error('Invalid service URL');
  const resolved: ResolvedOptions = {
    baseUrl, fetch: options.fetch ?? fetch, headers: { ...options.headers },
    maximumBytes: limit(options.maximumBytes ?? 1_048_576, 16_777_216, 'bytes'),
    timeoutMs: limit(options.timeoutMs ?? 30_000, 300_000, 'timeout'),
  };
  return { json: call => send(resolved, call, policy) };
}
