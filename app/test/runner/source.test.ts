import { executionArtifacts } from '@beetle/contracts';
import { expect, it } from 'vitest';
import type { SourceEnvelope } from '@beetle/contracts/output-source';
import { originalIdentity, envelope, selector, chunk, setup } from './source-fixtures.js';
import { otherId, turns } from './fixtures.js';

it('uses exact source routes and captured headers with shared owned manifest and chunk verification', async () => {
  const { gateway, native } = setup(); const identity = { ...originalIdentity() }; const client = gateway.output(identity);
  identity.journalAuthority = otherId; identity.attemptId = otherId; identity.intentDigest = 'e'.repeat(64);
  expect(Object.isFrozen(client)).toBe(true); expect(client).not.toHaveProperty('close');
  const source = client.source(); await turns(); const first = native.originals[0]!;
  first.body(envelope()); first.close(); const result = await source;
  expect(result).toEqual({ ok: true, value: envelope() });
  if (!result.ok) throw new Error('Expected verified source');
  expect(Object.isFrozen(executionArtifacts(result.value.manifest.result))).toBe(true);
  expect(Object.isFrozen(result.value.closure.receipt.key)).toBe(true);
  const pending = client.sourceChunk(selector(), 32); await turns(); const second = native.originals[1]!;
  second.body(chunk()); second.close(); const bytes = await pending;
  expect(bytes).toEqual({ ok: true, value: chunk() });
  if (!bytes.ok) throw new Error('Expected verified bytes');
  expect(Buffer.from(bytes.value.base64, 'base64')).toEqual(Buffer.alloc(32, 7)); expect(Object.isFrozen(bytes.value)).toBe(true);
  expect(first.options).toMatchObject({ method: 'GET', path: `/runner/v1/attempts/${originalIdentity().attemptId}/source`, agent: false,
    headers: { connection: 'close', 'accept-encoding': 'identity', 'x-beetle-journal-authority': originalIdentity().journalAuthority,
      'x-beetle-organization-id': originalIdentity().organizationId, 'x-beetle-workspace-id': originalIdentity().workspaceId, 'x-beetle-generation': '1' } });
  expect(first.request.end).toHaveBeenCalledWith(undefined);
  expect(second.options).toMatchObject({ method: 'POST', path: `${first.options.path}/chunk`, hostname: first.options.hostname });
  expect(JSON.parse(second.request.end.mock.calls[0]![0]!)).toEqual(selector());
});

it.each(['organizationId', 'workspaceId', 'attemptId', 'journalAuthority', 'intentDigest'] as const)(
  'rejects an internally valid source from another original %s', async field => {
    const { gateway, native } = setup();
    const identity = { ...originalIdentity(), [field]: field === 'intentDigest' ? 'a'.repeat(64) : otherId };
    const pending = gateway.output(identity).source(); await turns(); native.originals[0]!.body(envelope()); native.originals[0]!.close();
    expect(await pending).toEqual({ ok: false, error: { kind: 'response', status: 200 } });
  });

const mutations: Record<string, (value: SourceEnvelope) => void> = {
  'receipt authority': value => { value.closure.receipt.journalAuthority = otherId; },
  'receipt organization': value => { value.closure.receipt.key.organizationId = otherId; },
  'receipt workspace': value => { value.closure.receipt.key.workspaceId = otherId; },
  'receipt attempt': value => { value.closure.receipt.key.attemptId = otherId; },
  'receipt generation': value => { Reflect.set(value.closure.receipt.key, 'generation', 2); },
  'receipt manifest': value => { value.closure.receipt.manifestDigest = 'f'.repeat(64); },
  'receipt source': value => { value.closure.receipt.sourceDigest = 'f'.repeat(64); },
  'result seal': value => { value.manifest.result.seal.sha256 = 'f'.repeat(64); },
  'manifest digest': value => { value.manifest.manifestDigest = 'f'.repeat(64); },
};
it.each(Object.entries(mutations))('rejects %s through the shared envelope codec', async (_, change) => {
  const { client, native } = setup(); const value = envelope(); change(value);
  const pending = client.source(); await turns(); native.originals[0]!.body(value); native.originals[0]!.close();
  expect(await pending).toEqual({ ok: false, error: { kind: 'response', status: 200 } });
});

it.each([201, 202, 204, 302])('refuses source success status %i', async status => {
  const { client, native } = setup(); const pending = client.source(); await turns();
  native.originals[0]!.body(envelope(), status); native.originals[0]!.close();
  expect(await pending).toEqual({ ok: false, error: { kind: 'response', status } });
});

it.each(['source_pending', 'source_unavailable'] as const)('preserves scoped %s as a nonpositive protocol reply', async reason => {
  const { client, native } = setup(); const { organizationId, workspaceId, attemptId } = originalIdentity();
  const error = { protocolVersion: '1.0', organizationId, workspaceId, attemptId, reason,
    retry: reason === 'source_pending' ? 'transport' : 'never', issues: [] };
  const pending = client.source(); await turns(); native.originals[0]!.body(error, 409); native.originals[0]!.close();
  expect(await pending).toEqual({ ok: false, error: { kind: 'protocol', status: 409, protocol: error } });
});

it.each(['missing attempt', 'wrong attempt', 'wrong workspace', 'wrong retry', 'wrong status'])('refuses source errors with %s', async issue => {
  const { client, native } = setup(); const { organizationId, workspaceId, attemptId } = originalIdentity();
  const value: Record<string, unknown> = { protocolVersion: '1.0', organizationId, workspaceId, attemptId,
    reason: 'source_pending', retry: 'transport', issues: [] };
  if (issue === 'missing attempt') delete value.attemptId;
  if (issue === 'wrong attempt') value.attemptId = otherId;
  if (issue === 'wrong workspace') value.workspaceId = otherId;
  if (issue === 'wrong retry') value.retry = 'never';
  const status = issue === 'wrong status' ? 400 : 409;
  const pending = client.sourceChunk(selector(), 32); await turns(); native.originals[0]!.body(value, status); native.originals[0]!.close();
  expect(await pending).toEqual({ ok: false, error: { kind: 'response', status } });
});
