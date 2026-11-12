import { nodeFetch } from './http.js';
import { createApiClient, validateApi } from '@beetle/contracts/api';
import type { ApiClient, ApiClientFailure, BrowserSession } from '@beetle/contracts/api';
import { ClientError, ensureActive } from './errors.js';
import { readFileBounded, writeCredentials, prepareCredentialDestination } from './files.js';
import type { ClientOptions } from './options.js';
interface Credentials {version: 1; endpoint: string; origin: string; cookie: string; session: BrowserSession}
const secret = (value: unknown): value is string => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
export function clientFailure(error: ApiClientFailure, requestId?: string): never {
  if (error.status !== undefined && [400, 413, 422].includes(error.status)) throw new ClientError('invalid_input', 2);
  if (error.kind === 'request') throw new ClientError('invalid_input', 2);
  if (error.status === 401 || error.status === 403) throw new ClientError('unavailable', 5);
  if (requestId && uncertainMutation(error)) throw new ClientError('outcome_unknown', 3, requestId);
  if (error.status === 503 || error.status === 429) throw new ClientError('unavailable', 5);
  throw new ClientError('request_failed', 3);
}
function uncertainMutation(error: ApiClientFailure): boolean {return !error.status || error.status >= 500 || error.kind === 'response';}
function object(value: unknown): value is Record<string, unknown> {return value !== null && typeof value === 'object' && !Array.isArray(value);}
function captureCredentials(value: unknown, options: ClientOptions): Credentials {
  if (!object(value) || Object.keys(value).sort().join(',') !== 'cookie,endpoint,origin,session,version') throw new ClientError('invalid_input', 2);
  const session = validateApi('BrowserSession', value.session);
  if (!session.ok || !secret(value.cookie) || value.version !== 1 || value.endpoint !== options.endpoint || value.origin !== options.origin) throw new ClientError('invalid_input', 2);
  if (Date.parse(session.value.expiresAt) <= Date.now()) throw new ClientError('unavailable', 5);
  return {version: 1, endpoint: options.endpoint, origin: options.origin, cookie: value.cookie, session: session.value};
}
async function credentials(options: ClientOptions): Promise<Credentials> {
  try {return captureCredentials(JSON.parse(await readFileBounded(options.sessionFile, 4096, true)) as unknown, options);}
  catch (cause) {if (cause instanceof ClientError) throw cause; throw new ClientError('invalid_input', 2);}
}
function headers(options: ClientOptions): Record<string, string> {return {host: new URL(options.origin).host, origin: options.origin};}
export async function authenticatedClient(options: ClientOptions, fetcher = nodeFetch): Promise<ApiClient> {
  const grant = await credentials(options);
  return createApiClient({baseUrl: options.endpoint, fetch: fetcher, headers: {...headers(options),
    cookie: `beetle_session=${grant.cookie}`, 'x-beetle-csrf': grant.session.csrfToken}});
}
/** Capture only the one successful pairing cookie; the wire client owns the body. */
export async function pair(options: ClientOptions, signal: AbortSignal, fetcher = nodeFetch): Promise<void> {
  await prepareCredentialDestination(options.sessionFile);
  const text = await readFileBounded(options.tokenFile!, 64, true); const token = text.endsWith('\n') ? text.slice(0, -1) : text;
  if (!secret(token)) throw new ClientError('invalid_input', 2);
  let cookie: string | undefined; let calls = 0;
  const capture: typeof fetch = async (input, init) => {
    if (++calls !== 1) throw new ClientError('request_failed', 3);
    const response = await fetcher(input, init); const values = response.headers.getSetCookie();
    if (values.length === 1) {
      const secure = options.origin.startsWith('https:') ? '; Secure' : '';
      const match = /^beetle_session=([A-Za-z0-9_-]{43}); Path=\/api\/v2\/; HttpOnly; SameSite=Strict; Max-Age=28800(; Secure)?$/.exec(values[0]!);
      if (match && (match[2] ?? '') === secure) cookie = match[1];
    }
    return response;
  };
  const api = createApiClient({baseUrl: options.endpoint, fetch: capture, headers: {...headers(options), 'x-beetle-pair': '1'}});
  ensureActive(signal);
  const result = await api.pairBrowserSession({body: {bootstrapToken: token}, signal});
  if (!result.ok) clientFailure(result.error);
  if (!cookie) throw new ClientError('request_failed', 3);
  const grant: Credentials = {version: 1, endpoint: options.endpoint, origin: options.origin, cookie, session: result.value};
  ensureActive(signal);
  await writeCredentials(options.sessionFile, JSON.stringify(grant) + '\n');
}
