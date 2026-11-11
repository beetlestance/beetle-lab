import { expect, it, vi } from 'vitest';
import { verifyInstalledImages } from '../../src/bootstrap/installed-images.js';
import { UnixDockerTransport } from '../../src/backends/docker/index.js';
import type { DockerReply, DockerTransport, RequestFactory } from '../../src/backends/docker/index.js';
import { operation } from '../staging/fixtures.js';
import { deferred } from '../supervisor/fixtures.js';
import { fixture } from './fixtures.js';

const f = fixture();
it('checks actual engine image identity, environment, platform and daemon runtime through read-only paths', async () => {
  const e = await f.setup(); const request = vi.fn((input: Parameters<DockerTransport['request']>[0]) => e.options.transport.request(input));
  expect(await verifyInstalledImages({ catalog: e.options.catalog, transport: { request },
    expectedDaemonId: e.configuration.expectedDaemonId, operation: operation() })).toBe(true);
  expect(request.mock.calls.every(([input]) => input.method === 'GET')).toBe(true);
  expect(request.mock.calls.map(([input]) => input.path)).toEqual(['/v1.47/info', `/v1.47/images/${e.offer.engine.imageDigest}/json`]);
});

it.each(['missing', 'identity', 'environment', 'volume', 'platform', 'runtime', 'daemon'] as const)('rejects unqualified installed image: %s', async cause => {
  const e = await f.setup();
  const transport: DockerTransport = { async request(input) {
    const response = await e.options.transport.request(input); if (!response.ok) return response;
    const body = structuredClone(response.body) as Record<string, unknown>;
    if (input.path.endsWith('/info')) {
      if (cause === 'runtime') body.DefaultRuntime = 'other-runtime';
      if (cause === 'daemon') body.ID = 'other-daemon';
    } else {
      if (cause === 'missing') return { ok: true, status: 404, body: null };
      if (cause === 'identity') body.Id = `sha256:${'b'.repeat(64)}`;
      if (cause === 'platform') body.Architecture = 'amd64';
      const config = body.Config as Record<string, unknown>;
      if (cause === 'environment') config.Env = ['PATH=/other'];
      if (cause === 'volume') config.Volumes = { '/unexpected': {} };
    }
    return { ...response, body };
  } };
  expect(await verifyInstalledImages({ catalog: e.options.catalog, transport,
    expectedDaemonId: e.configuration.expectedDaemonId, operation: operation() })).toBe(false);
});

it('retains an aborted original image inspection and refuses its late success', async () => {
  const e = await f.setup(); const held = deferred<DockerReply>(); const abort = new AbortController();
  const request = vi.fn(async (input: Parameters<DockerTransport['request']>[0]) => input.path.includes('/images/')
    ? held.promise : e.options.transport.request(input));
  const checking = verifyInstalledImages({ catalog: e.options.catalog, transport: { request },
    expectedDaemonId: e.configuration.expectedDaemonId, operation: { ...operation(), signal: abort.signal } });
  let settled = false; void checking.then(() => { settled = true; });
  await vi.waitFor(() => { expect(request).toHaveBeenCalledTimes(2); }); abort.abort();
  await Promise.resolve(); expect(settled).toBe(false);
  held.resolve(await e.options.transport.request({ method: 'GET', path: `/v1.47/images/${e.offer.engine.imageDigest}/json`, ...operation() }));
  expect(await checking).toBe(false);
});

it('permits read-only installed and named image inspection while rejecting mutation and traversal', async () => {
  const factory: RequestFactory = vi.fn(() => { throw new Error('Synthetic unavailable socket'); });
  const transport = new UnixDockerTransport('/unused-docker.sock', factory);
  const path = `/v1.47/images/sha256:${'a'.repeat(64)}/json`;
  expect(await transport.request({ method: 'POST', path, ...operation() })).toMatchObject({ ok: false, reason: 'invalid_input', dispatched: false });
  expect(factory).not.toHaveBeenCalled();
  expect(await transport.request({ method: 'GET', path: '/v1.47/images/../json', ...operation() })).toMatchObject({ reason: 'invalid_input' });
  expect(factory).not.toHaveBeenCalled();
  expect(await transport.request({ method: 'GET', path, ...operation() })).toMatchObject({ ok: false, reason: 'unavailable' });
  expect(factory).toHaveBeenCalledOnce();
  expect(await transport.request({ method: 'GET', path: '/v1.47/images/latest/json', ...operation() })).toMatchObject({ reason: 'unavailable' });
  expect(factory).toHaveBeenCalledTimes(2);
  expect(await transport.request({ method: 'POST', path: '/v1.47/images/latest/json', ...operation() })).toMatchObject({ reason: 'invalid_input' });
  expect(factory).toHaveBeenCalledTimes(2);
});
