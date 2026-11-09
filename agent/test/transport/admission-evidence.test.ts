import { readFile } from 'node:fs/promises';
import { afterEach, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import type { AttemptSnapshot, Capabilities } from '@beetle/contracts';
import { validate } from '@beetle/contracts';
import { createAgentServer } from '../../src/transport/index.js';
import { fixture, operation, scope } from '../installation/fixtures.js';
import { configuration } from '../admission/fixtures.js';

const f = fixture(); const servers: FastifyInstance[] = [];
afterEach(async () => { await Promise.all(servers.splice(0).map(server => server.close())); });
async function installed() {
  const env = await f.setup(); const installation = env.create();
  const capabilities = JSON.parse(await readFile('contracts/fixtures/valid/capabilities.json', 'utf8')) as Capabilities;
  const server = createAgentServer({ credential: 'S'.repeat(64), installation, journal: env.owner,
    capabilities: async () => capabilities }); servers.push(server);
  const origin = await server.listen({ host: '127.0.0.1', port: 0 });
  const key = scope(env.offer); const url = `${origin}/runner/v1/attempts/${key.attemptId}`;
  const headers = { authorization: `Bearer ${'S'.repeat(64)}`, 'content-type': 'application/json',
    'x-beetle-organization-id': key.organizationId, 'x-beetle-workspace-id': key.workspaceId, 'x-beetle-generation': '1' };
  const request = async (method = 'GET', suffix = '', body?: unknown): Promise<AttemptSnapshot> => {
    const response = await fetch(url + suffix, { method, headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect(response.status).toBe(method === 'PUT' ? 202 : 200);
    const value: unknown = await response.json(); expect(validate('AttemptSnapshot', value).ok).toBe(true);
    return value as AttemptSnapshot;
  };
  return { ...env, installation, key, url, headers, request };
}
it('returns actual installed queued/refused facts and exact accepted Offer replay on loopback HTTP', async () => {
  const e = await installed();
  const queued = await e.request('PUT', '', e.offer);
  expect(queued).toMatchObject({ state: 'offered', lastSeq: 0, admission: { state: 'queued' } });
  const config = configuration(); config.perRun.cpuMillis = 500;
  await e.owner.admission({ kind: 'configure', configuration: config });
  await e.installation.drive(e.key, operation());
  const rejected = { ...queued, admission: { state: 'rejected', reason: 'per_run_ceiling' } };
  expect(await e.request()).toEqual(rejected);
  expect(await e.request('PUT', '', e.offer)).toEqual(rejected);
  expect((await e.owner.readEvents(e.key, 0)).events).toEqual([]);
  expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
});
it.each(['pending', 'charged'] as const)('returns installed %s cancellation facts on HTTP without forging release', async mode => {
  const e = await installed(); await e.request('PUT', '', e.offer);
  if (mode === 'charged') await f.admit(e.owner, e.offer, e.time.wall());
  const cancelled = await e.request('POST', '/cancel', { protocolVersion: '1.0', ...e.key });
  const fact = mode === 'pending' ? { state: 'rejected', reason: 'cancelled' } : { state: 'charged' };
  expect(cancelled).toMatchObject({ cancelRequested: true, admission: fact, lastSeq: mode === 'pending' ? 0 : 1 });
  expect(await e.request('PUT', '', e.offer)).toEqual(cancelled);
  if (mode === 'charged') {
    await e.owner.admission({ kind: 'abortUnstarted', key: e.key });
    expect(await e.request()).toEqual({ ...cancelled, admission: { state: 'released', disposition: 'never_started' } });
  }
  expect(e.backend.creates).toBe(0); expect(e.backend.starts).toBe(0);
});
it('returns settled evidence from the installed controller while redacting its original private custody', async () => {
  const e = await installed(); await e.request('PUT', '', e.offer);
  expect(await e.installation.drive(e.key, operation())).toMatchObject({ kind: 'runtime' });
  const charged = await e.request(); expect(charged.admission).toEqual({ state: 'charged' });
  await e.finish(e.installation);
  const final = await e.request(); expect(final.admission).toEqual({ state: 'released', disposition: 'settled' });
  expect(await e.request('PUT', '', e.offer)).toEqual(final);
  const original = (await e.installation.inspect(e.key)).allocation;
  if (!original || !('status' in original)) throw new Error('expected original allocation');
  expect(original).toMatchObject({ status: 'released', launchClosed: true,
    releaseEvidence: { authority: 'supervisor' } });
  for (const secret of [original.createToken, original.startToken, original.specDigest, original.runtimeId, e.rootPath]) {
    if (secret !== null) expect(JSON.stringify(final)).not.toContain(secret);
  }
  const refused = await fetch(e.url, { headers: { ...e.headers, 'x-beetle-generation': '2' } });
  expect(refused.status).toBe(409);
  expect(e.backend.creates).toBe(1); expect(e.backend.starts).toBe(1);
});
