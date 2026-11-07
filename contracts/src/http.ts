import type { ProtocolTypes, ProtocolError } from './generated/types.js';
import { validate } from './validate.js';
import type { ProtocolName, StructuralIssue } from './validate.js';
import { encodeJson, readJson } from './json.js';

export interface ClientFailure {
  readonly kind: 'request' | 'response' | 'transport' | 'cancelled' | 'timeout' | 'protocol';
  readonly status?: number;
  readonly issues?: readonly StructuralIssue[];
  readonly protocol?: ProtocolError;
}
export type ClientResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: ClientFailure };
export interface JsonCall<N extends ProtocolName> {
  method: string; path: string; response: N; successStatus: number; request?: ProtocolName; body?: unknown; signal?: AbortSignal | undefined;
}
export interface RunnerTransport {
  json<N extends ProtocolName>(call: JsonCall<N>): Promise<ClientResult<ProtocolTypes[N]>>;
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

function requestBody(call: JsonCall<ProtocolName>, maximum: number): ClientResult<string | undefined> {
  if (!call.request) return { ok: true, value: undefined };
  try {
    const body = encodeJson(call.body, maximum);
    const checked = validate(call.request, JSON.parse(body) as unknown);
    if (!checked.ok) return { ok: false, error: { kind: 'request', issues: checked.issues } };
    return { ok: true, value: body };
  } catch { return { ok: false, error: { kind: 'request' } }; }
}
function reply<N extends ProtocolName>(response: Response, input: unknown, call: JsonCall<N>): ClientResult<ProtocolTypes[N]> {
  if (!response.ok) {
    const error = validate('ProtocolError', input);
    return error.ok ? { ok: false, error: { kind: 'protocol', status: response.status, protocol: error.value } }
      : { ok: false, error: { kind: 'response', status: response.status, issues: error.issues } };
  }
  if (response.status !== call.successStatus) return { ok: false, error: { kind: 'response', status: response.status } };
  const checked = validate(call.response, input);
  return checked.ok ? checked : { ok: false, error: { kind: 'response', status: response.status, issues: checked.issues } };
}
function requestUrl(base: URL, path: string): URL | undefined {
  if (path.length > 2048 || !path.startsWith('/runner/v1/') || path.includes('\\')) return undefined;
  try {
    const url = new URL(path, base);
    if (url.origin !== base.origin || !url.pathname.startsWith('/runner/v1/') || url.hash) return undefined;
    return url;
  } catch { return undefined; }
}
function interrupted(signal: AbortSignal, caller: AbortSignal | undefined, fallback: 'transport' | 'response'): ClientFailure['kind'] {
  if (caller?.aborted) return 'cancelled';
  return signal.aborted ? 'timeout' : fallback;
}
async function send<N extends ProtocolName>(options: ResolvedOptions, call: JsonCall<N>): Promise<ClientResult<ProtocolTypes[N]>> {
  const url = requestUrl(options.baseUrl, call.path);
  if (!url) return { ok: false, error: { kind: 'request' } };
  const body = requestBody(call, options.maximumBytes);
  if (!body.ok) return body;
  const deadline = AbortSignal.timeout(options.timeoutMs);
  const signal = call.signal ? AbortSignal.any([call.signal, deadline]) : deadline;
  let response: Response;
  try {
    response = await options.fetch(url, {
      method: call.method, headers: { ...options.headers, 'content-type': 'application/json' },
      ...(body.value === undefined ? {} : { body: body.value }), signal, redirect: 'error',
    });
  } catch { return { ok: false, error: { kind: interrupted(signal, call.signal, 'transport') } }; }
  let input: unknown;
  try { input = await readJson(response, options.maximumBytes, signal); }
  catch { return { ok: false, error: { kind: interrupted(signal, call.signal, 'response'), status: response.status } }; }
  return reply(response, input, call);
}
function limit(value: number, maximum: number, name: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) throw new Error(`Invalid ${name} limit`);
  return value;
}

/** No retries: an execution retry requires explicit new user intent. */
export function createHttpTransport(options: HttpOptions): RunnerTransport {
  const baseUrl = new URL(options.baseUrl);
  if (!['http:', 'https:'].includes(baseUrl.protocol) || baseUrl.username || baseUrl.password) throw new Error('Invalid runner URL');
  const resolved: ResolvedOptions = {
    baseUrl, fetch: options.fetch ?? fetch, headers: { ...options.headers },
    maximumBytes: limit(options.maximumBytes ?? 1_048_576, 16_777_216, 'bytes'),
    timeoutMs: limit(options.timeoutMs ?? 30_000, 300_000, 'timeout'),
  };
  return { json: call => send(resolved, call) };
}
