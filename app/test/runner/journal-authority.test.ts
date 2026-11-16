import { expect, it } from 'vitest';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { matchesReply } from '../../src/adapters/outbound/runner/identity.js';
import type { AttemptSnapshot } from '@beetle/contracts';
import { fixture, identity, loopback, offer, send } from './fixtures.js';

it('pins exactly one authority header on real HTTP without adding it to the original Offer', async () => {
  const requests: Array<{ authority: string | string[] | undefined; count: number; body: string }> = [];
  const server = await loopback((request, response) => {
    let body = ''; request.on('data', (chunk: Buffer) => {
      if (Buffer.byteLength(body) + chunk.byteLength > 8192) { request.destroy(); return; }
      body += chunk.toString();
    });
    request.on('end', () => {
      if (requests.length >= 1) { response.destroy(); return; }
      requests.push({ authority: request.headers['x-beetle-journal-authority'],
        count: request.rawHeaders.filter(value => value.toLowerCase() === 'x-beetle-journal-authority').length, body });
      send(response, fixture<AttemptSnapshot>('snapshot'), 202);
    });
  });
  const gateway = createRunnerGateway(server.loaded);
  try {
    const captured = { ...identity }; const client = gateway.attempt(captured);
    captured.journalAuthority = 'abcdefab-cdef-4abc-8def-abcdefabcdef';
    const result = await client.offer(offer()); expect(result.ok).toBe(true);
    expect(requests).toHaveLength(1); expect(requests[0]?.authority).toBe(identity.journalAuthority); expect(requests[0]?.count).toBe(1);
    expect(JSON.parse(requests[0]!.body)).toEqual(offer()); expect(JSON.parse(requests[0]!.body)).not.toHaveProperty('journalAuthority');
  } finally { await gateway.close(); await server.close(); }
});
it('keeps transport authority separate from arbitrary logical JSON fields', () => {
  expect(matchesReply({ ...identity, journalAuthority: 'user data', nested: { journalAuthority: 42 } }, identity)).toBe(true);
  expect(matchesReply({ attemptId: 'abcdefab-cdef-4abc-8def-abcdefabcdef' }, identity)).toBe(false);
});
it('rejects missing or malformed expected authority before any transport operation', async () => {
  let calls = 0; const server = await loopback((_request, response) => { calls++; send(response, fixture('snapshot')); });
  const gateway = createRunnerGateway(server.loaded);
  try {
    const { journalAuthority: _authority, ...missing } = identity; void _authority;
    expect(() => gateway.attempt(missing as never)).toThrow('Invalid runner identity');
    expect(() => gateway.attempt({ ...identity, journalAuthority: '' })).toThrow('Invalid runner identity');
    expect(() => gateway.attempt({ ...identity, journalAuthority: 'not-uuid' })).toThrow('Invalid runner identity');
    expect(calls).toBe(0);
  } finally { await gateway.close(); await server.close(); }
});
