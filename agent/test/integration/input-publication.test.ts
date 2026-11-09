import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createHash } from 'node:crypto';
import { lstat, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { validateApi } from '@beetle/contracts/api';
import { openInstalledProviders } from '../../src/providers/index.js';
import { fixture, data, hash } from '../staging/fixtures.js';
import { scope } from '../admission/fixtures.js';

const f = fixture(); const run = promisify(execFile);
async function publish(e: Awaited<ReturnType<typeof f.environment>>, content: Uint8Array): Promise<string> {
  const input = { ...e.offer.inputs[0]!, bytes: content.byteLength, sha256: hash(content) }; e.offer.inputs = [input];
  const owner = { kind: 'workspace' as const, organizationId: e.offer.organizationId, workspaceId: e.offer.workspaceId };
  const descriptor = join(e.rootPath, 'publication.json');
  await writeFile(descriptor, JSON.stringify({ root: e.rootPath, scope: owner, id: input.id, sha256: input.sha256,
    data: Buffer.from(content).toString('base64') }), { mode: 0o600 });
  const child = await run(process.execPath, ['--import', 'tsx', 'app/test/integration/publish-input-cli.ts', descriptor],
    { maxBuffer: 8192, timeout: 5000 });
  const record: unknown = JSON.parse(child.stdout);
  expect(validateApi('InputRecord', record).ok).toBe(true);
  expect(record).toMatchObject({ scope: owner, id: input.id, bytes: content.byteLength,
    sha256: input.sha256, offset: content.byteLength, state: 'published', reason: null });
  const root = join(e.rootPath, 'publisher', 'published');
  const path = join(root, owner.organizationId, owner.workspaceId, input.id, input.sha256);
  const info = await lstat(path);
  expect(info.nlink).toBe(1); expect(info.mode & 0o777).toBe(0o600);
  expect(await readFile(path)).toEqual(Buffer.from(content));
  return root;
}

it.each([['UTF8 binary chunks', data], ['empty without append', Buffer.alloc(0)]] as const)(
  'stages actual application-published %s after metadata reopen and original create replay', async (_name, content) => {
    const e = await f.environment(false); const root = await publish(e, content);
    const providers = await openInstalledProviders({ configuration: { inputRoot: root, secretBindings: [] } });
    const stager = e.create({ providers });
    try {
      await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
      const prepared = e.prepare(stager); const result = await prepared.result; await prepared.quiesced;
      expect(result.ok).toBe(true); if (!result.ok) throw new Error(result.reason);
      const input = result.value.spec.HostConfig.Mounts.find(mount => mount.Target === '/beetle/input')!.Source;
      const actual = await readFile(join(input, 'input-000.bin'));
      expect(actual).toEqual(Buffer.from(content));
      expect(createHash('sha256').update(actual).digest('hex')).toBe(e.offer.inputs[0]!.sha256);
      expect(e.transport.calls.every(call => call.method === 'GET')).toBe(true);
    } finally { await stager.close(); await providers.close(); }
  });

it('rejects a changed published file through the real provider/Stager without starting an engine', async () => {
  const e = await f.environment(false); const root = await publish(e, data); const input = e.offer.inputs[0]!;
  await writeFile(join(root, e.offer.organizationId, e.offer.workspaceId, input.id, input.sha256), Buffer.alloc(input.bytes, 88));
  const providers = await openInstalledProviders({ configuration: { inputRoot: root, secretBindings: [] } });
  const stager = e.create({ providers });
  try {
    await f.enqueue(e.owner, e.offer); await f.admit(e.owner, e.offer);
    const prepared = e.prepare(stager); expect(await prepared.result).toEqual({ ok: false, reason: 'input_integrity' });
    await prepared.quiesced; await e.owner.admission({ kind: 'abortUnstarted', key: scope(e.offer) });
    expect(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) })).toMatchObject({ status: 'released', aborted: true });
    expect(e.transport.calls.every(call => call.method === 'GET')).toBe(true);
  } finally { await stager.close(); await providers.close(); }
});
