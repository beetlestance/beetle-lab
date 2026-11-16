import { isIP } from 'node:net';
import type { FastifyRequest } from 'fastify';
import { ApiFault } from '../api-errors.js';

export interface ExternalOrigin { readonly origin: string; readonly authority: string; readonly secure: boolean }

function loopback(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '[::1]' || (isIP(hostname) === 4 && hostname.startsWith('127.'));
}
function rootOrigin(url: URL): boolean {
  return loopback(url.hostname) && ['http:', 'https:'].includes(url.protocol) && !url.username && !url.password &&
    url.pathname === '/' && !url.search && !url.hash;
}

/** Reject URL aliases as well as remote authorities; wire checks use exact strings. */
export function externalOrigin(value: string): ExternalOrigin {
  try {
    if (typeof value !== 'string' || value.length > 256) throw new Error();
    const url = new URL(value);
    if (!rootOrigin(url) || (value !== url.origin && value !== `${url.origin}/`)) {
      throw new Error();
    }
    return Object.freeze({ origin: url.origin, authority: url.host, secure: url.protocol === 'https:' });
  } catch { throw new TypeError('Canonical loopback external origin required'); }
}

/** Bounded snapshot of raw headers, before Node's duplicate-header folding. */
export function requestHeaders(request: FastifyRequest): ReadonlyMap<string, readonly string[]> {
  const raw = request.raw.rawHeaders;
  if (raw.length > 256 || raw.length % 2 !== 0) throw new ApiFault('forbidden');
  let bytes = 0;
  const headers = new Map<string, string[]>();
  for (let i = 0; i < raw.length; i += 2) {
    const name = raw[i]!; const value = raw[i + 1]!;
    bytes += name.length + value.length;
    if (bytes > 16_384 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) || /[^\x20-\x7e]/.test(value)) {
      throw new ApiFault('forbidden');
    }
    const key = name.toLowerCase();
    const values = headers.get(key) ?? [];
    values.push(value); headers.set(key, values);
  }
  return headers;
}

export function singleHeader(headers: ReadonlyMap<string, readonly string[]>, name: string): string | undefined {
  const values = headers.get(name);
  if (values && values.length !== 1) throw new ApiFault('forbidden');
  return values?.[0];
}

export function checkOrigin(headers: ReadonlyMap<string, readonly string[]>, origin: ExternalOrigin, mutation: boolean): void {
  if (singleHeader(headers, 'host') !== origin.authority) throw new ApiFault('forbidden');
  const supplied = singleHeader(headers, 'origin');
  if ((supplied !== undefined && supplied !== origin.origin) || (mutation && supplied === undefined)) {
    throw new ApiFault('forbidden');
  }
  if (singleHeader(headers, 'sec-fetch-site') === 'cross-site') throw new ApiFault('forbidden');
}

export function sessionCookie(headers: ReadonlyMap<string, readonly string[]>, expectedName = 'beetle_session'): string | undefined {
  const text = singleHeader(headers, 'cookie');
  if (text === undefined) return undefined;
  if (text.length > 4096) throw new ApiFault('forbidden');
  const cookies = text.split(';');
  if (cookies.length > 64) throw new ApiFault('forbidden');
  let session: string | undefined;
  for (const cookie of cookies) {
    const {name, value} = cookiePair(cookie);
    if (name !== expectedName) continue;
    if (session !== undefined) throw new ApiFault('forbidden');
    session = value;
  }
  return session;
}

function cookiePair(cookie: string): {name: string; value: string} {
  const item = cookie.trim(); const equal = item.indexOf('=');
  const name = item.slice(0, equal); const value = item.slice(equal + 1);
  if (equal < 1 || !/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/.test(name) ||
    !/^[\x21\x23-\x2b\x2d-\x3a\x3c-\x5b\x5d-\x7e]*$/.test(value)) throw new ApiFault('forbidden');
  return {name, value};
}
