import { describe, expect, it } from 'vitest';
import type { Capabilities, EventBatch } from '@beetle/contracts';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { ack, cancellation, fixture, identity, loopback, offer, otherId, send } from './fixtures.js';

describe('actual Node runner scope and generated protocol', () => {
  it('performs all six methods with private authentication, captured identity and no caller mutation', async () => {
    const seen: { method: string | undefined; path: string | undefined; body: string }[] = [];
    const server = await loopback((request, response) => {
      expect(request.headers.authorization).toBe(`Bearer ${server.loaded.token}`);
      expect(request.headers.connection).toBe('close');
      expect(request.headers['accept-encoding']).toBe('identity');
      if (!request.url?.endsWith('capabilities')) {
        expect(request.headers['x-beetle-generation']).toBe('1');
        expect(request.headers['x-beetle-organization-id']).toBe(identity.organizationId);
        expect(request.headers['x-beetle-workspace-id']).toBe(identity.workspaceId);
      }
      let body = '';
      request.on('data', chunk => { body += String(chunk); });
      request.on('end', () => {
        seen.push({ method: request.method, path: request.url, body });
        if (request.url?.endsWith('capabilities')) send(response, fixture('capabilities'));
        else if (request.url?.endsWith('events?after=0')) send(response, fixture('events'));
        else if (request.url?.endsWith('ack')) send(response, fixture('ack-receipt'));
        else send(response, fixture('snapshot'), request.method === 'PUT' ? 202 : 200);
      });
    });
    const gateway = createRunnerGateway(server.loaded);
    const captured = { ...identity };
    const client = gateway.attempt(captured);
    captured.organizationId = otherId;
    const controller = new AbortController();
    try {
      expect(Object.isFrozen(client)).toBe(true);
      expect((await gateway.capabilities()).ok).toBe(true);
      expect((await client.offer(offer(), controller.signal)).ok).toBe(true);
      expect((await client.snapshot()).ok).toBe(true);
      expect((await client.cancel(cancellation())).ok).toBe(true);
      expect((await client.events(0)).ok).toBe(true);
      expect((await client.ack(ack())).ok).toBe(true);
      expect(seen.map(value => value.method)).toEqual(['GET', 'PUT', 'GET', 'POST', 'GET', 'POST']);
      expect(controller.signal.aborted).toBe(false);
    } finally { await gateway.close(); await server.close(); }
  });

  it('rejects wrong mutation identities, invalid cursor and generation before any request', async () => {
    let issued = 0;
    const server = await loopback((_request, response) => { issued++; send(response, fixture('snapshot')); });
    const gateway = createRunnerGateway(server.loaded);
    const client = gateway.attempt(identity);
    try {
      expect(await client.offer({ ...offer(), intentDigest: 'b'.repeat(64) })).toMatchObject({ ok: false, error: { kind: 'request' } });
      expect(await client.cancel({ ...cancellation(), workspaceId: otherId })).toMatchObject({ ok: false, error: { kind: 'request' } });
      expect(await client.ack({ ...ack(), generation: 2 })).toMatchObject({ ok: false, error: { kind: 'request' } });
      expect(await client.events(-1)).toMatchObject({ ok: false, error: { kind: 'request' } });
      expect(await gateway.attempt({ ...identity, generation: 2 }).offer(offer())).toMatchObject({ ok: false, error: { kind: 'request' } });
      expect(issued).toBe(0);
      expect(() => gateway.attempt({ ...identity, generation: 0 })).toThrow('Invalid runner identity');
    } finally { await gateway.close(); await server.close(); }
  });

  it.each(['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest'] as const)(
    'rejects mismatched snapshot %s', async field => {
      const reply = { ...fixture<Record<string, unknown>>('snapshot'), [field]: field === 'generation' ? 2 : field === 'intentDigest' ? 'b'.repeat(64) : otherId };
      const server = await loopback((_request, response) => send(response, reply));
      const gateway = createRunnerGateway(server.loaded);
      try { expect(await gateway.attempt(identity).snapshot()).toMatchObject({ ok: false, error: { kind: 'response' } }); }
      finally { await gateway.close(); await server.close(); }
    });

  it.each(['envelope', 'event', 'nested result', 'receipt', 'error', 'installation'])(
    'rejects mismatched %s identity', async kind => {
      let reply: unknown;
      if (kind === 'installation') {
        const value = fixture<Capabilities>('capabilities'); value.observation.installationId = otherId; reply = value;
      } else if (kind === 'error') reply = { ...fixture<object>('cursor-expired'), attemptId: otherId };
      else if (kind === 'receipt') reply = { ...fixture<object>('ack-receipt'), generation: 2 };
      else {
        const events = fixture<EventBatch>('events');
        if (kind === 'envelope') events.workspaceId = otherId;
        else if (kind === 'event') events.events[1]!.generation = 2;
        else {
          const event = events.events.find(event => event.kind === 'engine.result')!;
          (event.payload as Record<string, unknown>).organizationId = otherId;
        }
        reply = events;
      }
      const server = await loopback((_request, response) => send(response, reply, kind === 'error' ? 409 : 200));
      const gateway = createRunnerGateway(server.loaded);
      try {
        const client = gateway.attempt(identity);
        const result = await (kind === 'installation' ? gateway.capabilities() : kind === 'receipt' ? client.ack(ack()) : client.events(0));
        expect(result).toMatchObject({ ok: false, error: { kind: 'response' } });
      } finally { await gateway.close(); await server.close(); }
    });

  it('returns only validated scoped remote errors and rejects empty/redirect/extra-field replies', async () => {
    const replies = [0, 1, 2, 3];
    const server = await loopback((_request, response) => {
      const index = replies.shift();
      if (index === 0) send(response, fixture('cursor-expired'), 409);
      else if (index === 1) { response.writeHead(401); response.end(); }
      else if (index === 2) { response.writeHead(302, { location: 'http://example.invalid' }); response.end(); }
      else send(response, { ...fixture<object>('snapshot'), secret: 'synthetic-redaction-canary' });
    });
    const gateway = createRunnerGateway(server.loaded);
    try {
      const client = gateway.attempt(identity);
      expect(await client.snapshot()).toMatchObject({ ok: false, error: { kind: 'protocol', status: 409 } });
      for (let index = 0; index < 3; index++) {
        const result = await client.snapshot();
        expect(result).toMatchObject({ ok: false, error: { kind: 'response' } });
        expect(JSON.stringify(result)).not.toContain('synthetic-redaction-canary');
      }
    } finally { await gateway.close(); await server.close(); }
  });
});
