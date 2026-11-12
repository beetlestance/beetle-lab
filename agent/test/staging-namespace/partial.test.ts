import type { Journal } from '../../src/journal/index.js';
import type { StagingNamespaceJournal } from '../../src/staging-namespace/index.js';
import { expect, it, vi } from 'vitest';
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NamespaceBinding, verifyInstallation } from '../../src/staging/index.js';
import { namespaceCaps } from '../../src/staging-namespace/index.js';
import { runtimeName } from '../../src/runtime-identity.js';
import { fixture, Inspection, operation } from '../staging/fixtures.js';
import { scope } from '../admission/fixtures.js';
const f = fixture();
async function actualRoot(options: Parameters<typeof verifyInstallation>[0]) {
  const result = await verifyInstallation(options);
  if (!result.ok) throw new Error('Invalid actual root');
  return result.value;
}
function lostReply(journal: Journal, phase: 'intent' | 'commit'): StagingNamespaceJournal {
  const port = { ...journal.stagingNamespace };
  if (phase === 'intent') port.begin = async root => { await journal.stagingNamespace.begin(root); throw new Error('Synthetic lost intent reply'); };
  else port.commit = async request => { await journal.stagingNamespace.commit(request); throw new Error('Synthetic lost commit reply'); };
  return port;
}
it.each(['intent', 'commit'] as const)('reconciles a lost namespace %s reply using the same actual marker and durable key', async phase => {
  const e = await f.environment(false); const rootPath = join(e.rootPath, 'fresh-install'); await mkdir(rootPath, { mode: 0o700 });
  const configuration = { ...e.configuration, stagingRoot: rootPath }; const transport = new Inspection(configuration);
  const journal = await f.open(); const journalAuthority = await journal.journalAuthority();
  const verified = await actualRoot({ configuration, transport, operation: operation() });
  const port = lostReply(journal, phase);
  const failed = new NamespaceBinding({ root: verified, journal: port, journalAuthority, operation: operation() });
  try { await expect(failed.bind()).rejects.toThrow('Synthetic lost'); } finally { await failed.close(); }
  const before = await journal.stagingNamespace.read(); expect(before?.state).toBe(phase === 'intent' ? 'preparing' : 'bound');
  const markerBefore = phase === 'commit' ? await readFile(join(rootPath, namespaceCaps.markerName)) : null;
  const fresh = await actualRoot({ configuration, transport, operation: operation() });
  const resumed = new NamespaceBinding({ root: fresh, journal: journal.stagingNamespace, journalAuthority, operation: operation() });
  try { expect((await resumed.bind()).namespaceId).toBe(before?.intent.namespaceId); } finally { await resumed.close(); }
  const after = await journal.stagingNamespace.read(); expect(after?.state).toBe('bound'); expect(after?.intent).toEqual(before?.intent);
  if (markerBefore) expect(await readFile(join(rootPath, namespaceCaps.markerName))).toEqual(markerBefore);
  expect(await readdir(rootPath)).toEqual([namespaceCaps.markerName]);
});
it('keeps partial task directory creation unadopted, charged and provider-free', async () => {
  const e = await f.environment(false); await f.enqueue(e.owner, e.offer); const reservation = await f.admit(e.owner, e.offer);
  const root = join(e.rootPath, runtimeName({ ...scope(e.offer), installationId: e.options.profile.installationId }));
  await mkdir(root, { mode: 0o700 }); await writeFile(join(root, 'canary'), 'keep', { mode: 0o600 });
  const providers = { input: vi.fn(e.options.providers.input), secret: vi.fn(e.options.providers.secret) };
  const attempt = e.prepare(e.create({ providers })); expect(await attempt.result).toEqual({ ok: false, reason: 'recovery_required' }); await attempt.quiesced;
  const state = await e.owner.stagingNamespace.readTask({ ...scope(e.offer), generation: 1 }); expect(state?.state).toBe('preparing');
  expect(providers.input).not.toHaveBeenCalled(); expect(providers.secret).not.toHaveBeenCalled();
  expect(await readFile(join(root, 'canary'), 'utf8')).toBe('keep'); expect(await readdir(root)).toEqual(['canary']);
  expect(await e.owner.admission({ kind: 'reservation', key: scope(e.offer) })).toEqual(reservation);
});
