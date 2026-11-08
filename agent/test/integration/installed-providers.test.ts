import { expect, it } from 'vitest';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { openInstalledProviders } from '../../src/providers/index.js';
import { fixture, data } from '../staging/fixtures.js';
import { scope } from '../admission/fixtures.js';

const f = fixture();
it('stages actual scoped bytes and explicit secrets without placing resolved values in the offer', async () => {
  const e = await f.environment(false); const root = join(e.rootPath, 'installed-inputs');
  const reference = e.offer.inputs[0]!;
  const source = join(root, e.offer.organizationId, e.offer.workspaceId, reference.id, reference.sha256);
  await mkdir(dirname(source), { recursive: true, mode: 0o700 }); await writeFile(source, data, { mode: 0o600 });
  const secret = { name: 'TOKEN', provider: 'env' as const, reference: 'run-token', version: 'v1' };
  e.offer.secretReferences = [secret];
  const providers = await openInstalledProviders({ configuration: { inputRoot: root, secretBindings: [{
    organizationId: e.offer.organizationId, workspaceId: e.offer.workspaceId, ...secret, source: 'ALLOWED_TOKEN',
  }] }, environment: { ALLOWED_TOKEN: 'SYNTHETIC_PROVIDER_SENTINEL' } });
  try {
    await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
    const preparation = e.prepare(e.create({ providers })); const result = await preparation.result; await preparation.quiesced;
    expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.reason);
    const input = result.value.spec.HostConfig.Mounts.find(mount => mount.Target === '/beetle/input')!.Source;
    const secrets = result.value.spec.HostConfig.Mounts.find(mount => mount.Target === '/beetle/secrets')!.Source;
    expect(await readFile(join(input, 'input-000.bin'))).toEqual(data);
    expect(await readFile(join(secrets, secret.name), 'utf8')).toBe('SYNTHETIC_PROVIDER_SENTINEL');
    const persisted = await readFile(join(input, 'offer.json'), 'utf8');
    expect(persisted).not.toContain('SYNTHETIC_PROVIDER_SENTINEL');
    expect(JSON.parse(persisted).secretReferences).toEqual([secret]);
    expect(e.transport.calls.every(call => call.method === 'GET')).toBe(true);
  } finally { await providers.close(); }
});

it('fails the admitted input hash and proves quiescence before safe unstarted abort', async () => {
  const e = await f.environment(false); const root = join(e.rootPath, 'installed-inputs'); const reference = e.offer.inputs[0]!;
  const source = join(root, e.offer.organizationId, e.offer.workspaceId, reference.id, reference.sha256);
  await mkdir(dirname(source), { recursive: true, mode: 0o700 });
  await writeFile(source, Buffer.alloc(data.byteLength, 88), { mode: 0o600 });
  const providers = await openInstalledProviders({ configuration: { inputRoot: root, secretBindings: [] } });
  try {
    await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
    const preparation = e.prepare(e.create({ providers }));
    expect(await preparation.result).toEqual({ ok: false, reason: 'input_integrity' });
    await preparation.quiesced;
    await e.owner.admission({ kind: 'abortUnstarted', key: scope(e.offer) });
    expect(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) })).toMatchObject({ status: 'released', aborted: true });
    expect(e.transport.calls.every(call => call.method === 'GET')).toBe(true);
  } finally { await providers.close(); }
});
