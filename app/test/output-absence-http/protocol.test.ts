import { expect, it } from 'vitest';
import { captureOutputAbsence } from '@beetle/contracts/output-source';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { originalIdentity, setup } from '../runner/source-fixtures.js';
import { loopback, send, turns, otherId } from '../runner/fixtures.js';

export function proof() {
  return captureOutputAbsence({ ...originalIdentity(), version: 1, finalAgentSeq: 0,
    admission: { state: 'rejected', reason: 'unsupported_capability' }, reason: 'unsupported_capability' });
}
function marker() {
  const { organizationId, workspaceId, attemptId } = originalIdentity();
  return { protocolVersion: '1.0', organizationId, workspaceId, attemptId, reason: 'source_absent', retry: 'never', issues: [] };
}

it('reads bounded proof on actual native HTTP with original headers and no retry', async () => {
  let calls = 0;
  const server = await loopback((request, response) => {
    calls++;
    expect(request.method).toBe('GET'); expect(request.url).toBe(`/runner/v1/attempts/${originalIdentity().attemptId}/source/absence`);
    expect(request.headers).toMatchObject({ authorization: `Bearer ${server.loaded.token}`,
      'x-beetle-journal-authority': originalIdentity().journalAuthority, 'x-beetle-generation': '1', connection: 'close' });
    send(response, proof());
  });
  const gateway = createRunnerGateway(server.loaded);
  try {
    const input = { ...originalIdentity() }; const client = gateway.output(input); input.intentDigest = 'f'.repeat(64);
    const result = await client.absence(); expect(result).toEqual({ ok: true, value: proof() });
    expect(calls).toBe(1); expect(Object.isFrozen(client)).toBe(true);
    if (!result.ok) throw new Error('Expected proof');
    expect(Object.isFrozen(result.value.admission)).toBe(true);
  } finally { await gateway.close(); await server.close(); }
});

it.each(['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest', 'journalAuthority', 'malformed'])(
  'rejects %s proof from native HTTP without retry', async field => {
    let calls = 0; const value = { ...proof(), [field]: field === 'intentDigest' ? 'f'.repeat(64) : field === 'generation' ? 2 : otherId };
    const server = await loopback((_, response) => { calls++; send(response, value); });
    const gateway = createRunnerGateway(server.loaded);
    try { expect(await gateway.output(originalIdentity()).absence()).toEqual({ ok: false, error: { kind: 'response', status: 200 } }); expect(calls).toBe(1); }
    finally { await gateway.close(); await server.close(); }
  });

it.each(['oversize-length', 'oversize-stream', 'invalid-json', 'redirect', 'pending', 'unknown'])(
  'retains %s as a nonpositive native response', async issue => {
    let calls = 0;
    const server = await loopback((_, response) => {
      calls++;
      if (issue === 'oversize-length') { response.writeHead(200, { 'content-type': 'application/json', 'content-length': 2049 }); response.end(' '.repeat(2049)); }
      if (issue === 'oversize-stream') { response.writeHead(200, { 'content-type': 'application/json' }); response.write(' '.repeat(2049)); response.end(); }
      if (issue === 'invalid-json') { response.writeHead(200, { 'content-type': 'application/json' }); response.end('{'); }
      if (issue === 'redirect') send(response, proof(), 302);
      if (issue === 'pending') send(response, { ...marker(), reason: 'source_pending', retry: 'transport' }, 409);
      if (issue === 'unknown') send(response, { ...marker(), reason: 'attempt_not_found' }, 404);
    });
    const gateway = createRunnerGateway(server.loaded);
    try {
      const result = await gateway.output(originalIdentity()).absence(); expect(result.ok).toBe(false);
      if (result.ok) throw new Error('Unexpected positive proof');
      expect(result.error.kind).toBe(['pending', 'unknown'].includes(issue) ? 'protocol' : 'response'); expect(calls).toBe(1);
    } finally { await gateway.close(); await server.close(); }
  });

it.each(['valid', 'status', 'retry', 'attempt', 'scope', 'extra', 'nonobject'])(
  'classifies %s source_absent marker strictly without granting proof', async issue => {
    const { client, native } = setup(); const value = { ...marker() };
    if (issue === 'retry') value.retry = 'transport';
    if (issue === 'attempt') value.attemptId = otherId;
    if (issue === 'scope') value.workspaceId = otherId;
    if (issue === 'extra') Reflect.set(value, 'credit', 1);
    const status = issue === 'status' ? 404 : 409;
    const pending = client.source(); await turns(); native.originals[0]!.body(issue === 'nonobject' ? null : value, status); native.originals[0]!.close();
    expect(await pending).toEqual(issue === 'valid' ? { ok: false, error: { kind: 'protocol', status, protocol: value } }
      : { ok: false, error: { kind: 'response', status } });
  });
