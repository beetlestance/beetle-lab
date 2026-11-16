import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createHttpTransport, createRunnerClient } from '@beetle/contracts';
import type { Offer } from '@beetle/contracts';
import { config } from '../catalog/fixtures.js';

export const hash = (value: string | Uint8Array): string => createHash('sha256').update(value).digest('hex');
export const jsonBytes = (value: unknown): number => Buffer.byteLength(JSON.stringify(value));
/** Generated schema-valid body with mixed UTF8 and JSON escapes; no production serializer oracle. */
export function fullConfig(maximum = 1_048_576) {
  const value: string[] = Array.from({ length: 200 }, () => '🪲 café"\\'.repeat(200));
  const base = config();
  const result = { ...base, requests: [{ ...base.requests[0]!, method: 'POST', body: { kind: 'json', value } }] };
  while (maximum - jsonBytes(result) > 4100) value.push('x'.repeat(4096));
  value.push('');
  value[value.length - 1] = 'x'.repeat(maximum - jsonBytes(result));
  if (jsonBytes(result) !== maximum) throw new Error('fixture_size');
  return result;
}
export function fullOffer(base: Offer, maximum = 1_048_576): Offer {
  return { ...base, inputs: [], secretReferences: [], config: fullConfig(maximum) };
}
export function pairedClient(server: FastifyInstance, headers: Record<string, string>) {
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
    const response = await server.inject({ method: init?.method as 'GET' | 'PUT' | 'POST',
      url: url.pathname + url.search, headers: Object.fromEntries(new Headers(init?.headers).entries()),
      ...(typeof init?.body === 'string' ? { payload: init.body } : {}) });
    return new Response(response.body, { status: response.statusCode, headers: { 'content-type': 'application/json' } });
  };
  return createRunnerClient(createHttpTransport({ baseUrl: 'http://agent.test', fetch: fetcher, headers }));
}
