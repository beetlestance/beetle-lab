/* global Headers, Response, fetch */
import assert from 'node:assert/strict';
import { request } from 'node:https';
import { Readable } from 'node:stream';
import { setTimeout as sleep } from 'node:timers/promises';
import { hostname } from './network.mjs';

/**
 * Node-side HTTPS to the proxy's loopback port, resolving only the qualification hostname and
 * trusting only its throwaway certificate. Raw headers are sent exactly as given.
 * @param {string} ca
 * @returns {typeof fetch}
 */
export function proxyTransport(ca) {
  /** @type {import('node:net').LookupFunction} */
  const lookup = (name, options, done) => {
    if (name !== hostname) return done(new Error('Unexpected hostname'), '', 4);
    if (options.all) return /** @type {any} */ (done)(null, [{ address: '127.0.0.1', family: 4 }]);
    return done(null, '127.0.0.1', 4);
  };
  return async (input, init) => {
    const url = new URL(String(input));
    const headers = Object.fromEntries(new Headers(init?.headers));
    return new Promise((resolve, reject) => {
      const outgoing = request(
        url,
        { method: init?.method ?? 'GET', headers, ca, lookup, signal: init?.signal ?? undefined },
        (incoming) => {
          const responseHeaders = new Headers();
          for (const [name, value] of Object.entries(incoming.headers))
            for (const item of [value ?? []].flat()) responseHeaders.append(name, item);
          const status = incoming.statusCode ?? 502;
          const body = [204, 304].includes(status) ? null : /** @type {ReadableStream} */ (Readable.toWeb(incoming));
          resolve(new Response(body, { status, headers: responseHeaders }));
        },
      );
      outgoing.on('error', reject);
      outgoing.end(typeof init?.body === 'string' ? init.body : undefined);
    });
  };
}

/** @param {import('@playwright/test').Page} page */
export async function secureContext(page) {
  const facts = await page.evaluate(() => ({
    secure: globalThis.isSecureContext,
    subtle: typeof globalThis.crypto?.subtle?.digest === 'function',
    uuid: typeof globalThis.crypto?.randomUUID === 'function',
    origin: globalThis.location.origin,
  }));
  assert.deepEqual(facts, { secure: true, subtle: true, uuid: true, origin: new URL(page.url()).origin });
  return facts;
}

/**
 * Host, Origin and CSRF refusals through the proxy, and the loopback frontend port refused for
 * the configured HTTPS origin. Returns the observed statuses.
 * @param {{ origin: string, ca: string, proxyPort: number, frontendOrigin: string }} network
 */
export async function refusals(network) {
  const transport = proxyTransport(network.ca);
  const json = { 'content-type': 'application/json', 'x-beetle-local': '1' };
  const local = (/** @type {Record<string, string>} */ headers) =>
    transport(new URL('/api/v2/auth/local', network.origin), { method: 'POST', headers, body: '{}' });
  const opened = await local({ ...json, origin: network.origin });
  assert.equal(opened.status, 200, 'The exact origin must open a session');
  const cookie = String(opened.headers.get('set-cookie')).split(';')[0] ?? '';
  const statuses = {
    exact: opened.status,
    wrongHost: (await local({ ...json, origin: network.origin, host: `127.0.0.1:${network.proxyPort}` })).status,
    wrongOrigin: (await local({ ...json, origin: `https://other.${hostname}:${network.proxyPort}` })).status,
    missingCsrf: (
      await transport(new URL('/api/v2/auth/logout', network.origin), {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: network.origin, cookie },
        body: '{}',
      })
    ).status,
    loopbackFrontend: (
      await fetch(new URL('/api/v2/auth/local', network.frontendOrigin), {
        method: 'POST',
        headers: { ...json, origin: network.frontendOrigin },
        body: '{}',
      })
    ).status,
  };
  assert.deepEqual(statuses, { exact: 200, wrongHost: 403, wrongOrigin: 403, missingCsrf: 403, loopbackFrontend: 403 });
  return statuses;
}

/**
 * Connects to the run-server container on the ingress network; it resolves the hostname itself.
 * @template T
 * @param {{ connect(endpoint: string): Promise<T> }} driver
 * @param {string} endpoint
 */
export async function connectBrowser(driver, endpoint) {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      return await driver.connect(endpoint);
    } catch (error) {
      if (Date.now() > deadline) throw error;
      await sleep(1000);
    }
  }
}
