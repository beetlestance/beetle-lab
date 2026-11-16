import { expect, it } from 'vitest';
import { chmod, mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { verifyInstallation, Stager } from '../../src/staging/index.js';
import { fixture, operation } from './fixtures.js';

const f = fixture();
it('verifies read-only daemon/agent and an existing owned canonical root', async () => {
  const e = await f.environment();
  expect(e.transport.calls.map(call => [call.method, call.path])).toEqual([
    ['GET', '/v1.47/info'], ['GET', '/v1.47/containers/synthetic-agent/json']]);
  expect(Object.isFrozen(e.options.root)).toBe(true);
  expect(() => new Stager({ ...e.options, root: {} as never })).toThrow('Staging installation');
  expect(() => new Stager({ ...e.options, profile: { ...e.options.profile, installationId: e.offer.attemptId } })).toThrow('Staging installation');
});
it.each(['daemon', 'os', 'name', 'image', 'user', 'running', 'paused', 'readonly', 'source', 'propagation', 'nested', 'duplicate'])('rejects %s inspection mismatch', async field => {
  const e = await f.environment();
  const agent = e.transport.agent;
  const mounts = agent.Mounts as Record<string, unknown>[];
  const mutations: Record<string, () => void> = {
    daemon: () => { e.transport.info.ID = 'other'; }, os: () => { e.transport.info.OSType = 'windows'; },
    name: () => { agent.Name = '/other'; }, image: () => { agent.Image = `sha256:${'d'.repeat(64)}`; },
    user: () => { (agent.Config as Record<string, unknown>).User = '1:1'; },
    running: () => { (agent.State as Record<string, unknown>).Running = false; },
    paused: () => { (agent.State as Record<string, unknown>).Paused = true; },
    readonly: () => { mounts[0]!.RW = false; }, source: () => { mounts[0]!.Source = `${e.rootPath}-other`; },
    propagation: () => { mounts[0]!.Propagation = 'shared'; },
    nested: () => { mounts.push({ ...mounts[0], Destination: join(e.rootPath, 'nested') }); },
    duplicate: () => { mounts.push({ ...mounts[0] }); },
  };
  mutations[field]!();
  expect(await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() })).toEqual({ ok: false, reason: 'installation' });
});
it('rejects missing/symlink/unsafe-permission roots and local identity mismatch', async () => {
  const e = await f.environment();
  for (const root of [join(e.rootPath, 'missing'), join(e.rootPath, 'alias')]) {
    if (root.endsWith('alias')) await symlink(e.rootPath, root);
    const configuration = { ...e.configuration, stagingRoot: root };
    (e.transport.agent.Mounts as Record<string, unknown>[])[0] = { Type: 'bind', Source: root, Destination: root, RW: true, Propagation: 'rprivate' };
    expect((await verifyInstallation({ configuration, transport: e.transport, operation: operation() })).ok).toBe(false);
  }
  const unsafe = join(e.rootPath, 'unsafe'); await mkdir(unsafe); await chmod(unsafe, 0o777);
  const configuration = { ...e.configuration, stagingRoot: unsafe };
  (e.transport.agent.Mounts as Record<string, unknown>[])[0] = { Type: 'bind', Source: unsafe, Destination: unsafe, RW: true, Propagation: 'rprivate' };
  expect((await verifyInstallation({ configuration, transport: e.transport, operation: operation() })).ok).toBe(false);
  expect((await verifyInstallation({ configuration: { ...configuration, user: '1:1' }, transport: e.transport, operation: operation() })).ok).toBe(false);
});
it('bounds replies without invoking accessors or accepting huge inspection', async () => {
  const e = await f.environment(); let invoked = false;
  Object.defineProperty(e.transport.info, 'trap', { enumerable: true, get() { invoked = true; return 'bad'; } });
  expect((await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() })).ok).toBe(false);
  expect(invoked).toBe(false);
  e.transport.info = { ID: 'synthetic-daemon', OSType: 'linux', huge: 'x'.repeat(1_048_576) };
  expect((await verifyInstallation({ configuration: e.configuration, transport: e.transport, operation: operation() })).ok).toBe(false);
});
