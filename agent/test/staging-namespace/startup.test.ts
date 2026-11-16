import { expect, it, vi } from 'vitest';
import { mkdir, readdir, rename, rm } from 'node:fs/promises';
import { Journal } from '../../src/journal/index.js';
import { openAgentRuntime } from '../../src/bootstrap/index.js';
import { fixture } from '../bootstrap/fixtures.js';
const f = fixture();
it('blocks a wrong-root startup before configure/intake/producer work and recovers only the retained exact root', async () => {
  const e = await f.setup(); const saved = e.rootPath + '-retained';
  const journal = await f.open(e.journalPath); const accepted = await journal.immutableOffer(e.offer); await f.close(journal);
  await rename(e.rootPath, saved); await mkdir(e.rootPath, { mode: 0o700 });
  const admission = vi.spyOn(Journal.prototype, 'admission'); const providers = { input: vi.fn(e.options.providers.input), secret: vi.fn(e.options.providers.secret) };
  try {
    await expect(openAgentRuntime({ ...e.options, providers })).rejects.toMatchObject({ reason: 'recovery_required' });
    expect(admission).not.toHaveBeenCalled(); expect(providers.input).not.toHaveBeenCalled(); expect(providers.secret).not.toHaveBeenCalled();
    expect(e.daemon.calls.some(call => call.method !== 'GET')).toBe(false); expect(await readdir(e.rootPath)).toEqual([]);
  } finally {
    admission.mockRestore(); await rm(e.rootPath, { recursive: true, force: true }); await rename(saved, e.rootPath);
  }
  const runtime = f.keep(await openAgentRuntime(e.options)); expect(await runtime.initial).toEqual({ ready: true }); await runtime.close();
  const reopened = await f.open(e.journalPath); expect(await reopened.get({ attemptId: e.offer.attemptId, organizationId: e.offer.organizationId, workspaceId: e.offer.workspaceId })).toEqual(accepted);
  expect(e.daemon.calls.some(call => call.path.includes('/create?') || call.path.endsWith('/start'))).toBe(false);
});
