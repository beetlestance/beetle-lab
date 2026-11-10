import { expect, it } from 'vitest';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { fixture, identity, loopback, offer, otherId, send } from './fixtures.js';

it('sends the exact original to the distinct refusal route under captured authority', async () => {
  const seen: { path: string | undefined; body: unknown }[] = [];
  const server = await loopback((request, response) => {
    expect(request.method).toBe('POST');
    expect(request.headers['x-beetle-journal-authority']).toBe(identity.journalAuthority);
    expect(request.headers.authorization).toBe(`Bearer ${server.loaded.token}`);
    let text = '';
    request.on('data', chunk => { text += String(chunk); });
    request.on('end', () => {
      seen.push({ path: request.url, body: JSON.parse(text) });
      send(response, fixture('snapshot'));
    });
  });
  const gateway = createRunnerGateway(server.loaded);
  try {
    expect((await gateway.attempt(identity).cancelOriginal(offer())).ok).toBe(true);
    expect(seen).toEqual([{ path: `/runner/v1/attempts/${identity.attemptId}/cancel-original`, body: offer() }]);
  } finally { await gateway.close(); await server.close(); }
});

it('rejects mismatched original identity and later generation without issuing HTTP', async () => {
  let calls = 0;
  const server = await loopback((_request, response) => { calls++; send(response, fixture('snapshot')); });
  const gateway = createRunnerGateway(server.loaded);
  try {
    expect(await gateway.attempt(identity).cancelOriginal({ ...offer(), workspaceId: otherId }))
      .toMatchObject({ ok: false, error: { kind: 'request' } });
    expect(await gateway.attempt({ ...identity, generation: 2 }).cancelOriginal(offer()))
      .toMatchObject({ ok: false, error: { kind: 'request' } });
    expect(calls).toBe(0);
  } finally { await gateway.close(); await server.close(); }
});

it('retains an old-server rejection without retrying through normal Offer', async () => {
  const calls: string[] = [];
  const server = await loopback((request, response) => {
    calls.push(`${request.method} ${request.url}`);
    send(response, { message: 'unsupported route' }, 404);
  });
  const gateway = createRunnerGateway(server.loaded);
  try {
    expect(await gateway.attempt(identity).cancelOriginal(offer()))
      .toMatchObject({ ok: false, error: { kind: 'response', status: 404 } });
    expect(calls).toEqual([`POST /runner/v1/attempts/${identity.attemptId}/cancel-original`]);
  } finally { await gateway.close(); await server.close(); }
});
