import { build } from 'tsup';
import { expect, it, vi } from 'vitest';
import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { DatabaseSync } from 'node:sqlite';
import { openJournal } from '../../../agent/src/journal/index.js';
import { openServingState } from '../../../agent/src/installation-state/index.js';
import { installationStatePath } from '../../../agent/src/bootstrap/index.js';
import { registration } from '../../../agent/test/catalog/fixtures.js';
import { configuration } from '../../../agent/test/admission/fixtures.js';
import { initializeFreshInstallation, initializationWorkerUrl } from './initialize.js';

it('initializes the actual loaded journal and ready gate, closes ownership, and preserves authority on reopen', async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-app-initialization-')));
  const uid = process.getuid!(); const gid = process.getgid!();
  const configPath = join(root, 'agent.json');
  const installed = registration(); const user = `${uid}:${gid}`;
  const journalDirectory = join(root, 'actual-configured-journal');
  const credentialFile = join(root, 'credential'); const inputRoot = join(root, 'inputs');
  try {
    const outDir = join(root, 'compiled-worker');
    await build({ entry: ['agent/src/journal/worker.ts'], outDir, format: ['esm'],
      platform: 'node', target: 'node24', bundle: true, noExternal: [/.*/], shims: true,
      removeNodeProtocol: false, splitting: false, silent: true });
    vi.stubEnv('BEETLE_AGENT_WORKER_FILE', join(outDir, 'worker.js'));
    await mkdir(journalDirectory, { mode: 0o700 }); await mkdir(inputRoot, { mode: 0o700 });
    await writeFile(credentialFile, 'S'.repeat(64), { mode: 0o600 });
    const { profiles: omitted, ...pool } = configuration(); void omitted;
    const { manifestId, profileId, catalogVersion } = installed.validation;
    await writeFile(configPath, JSON.stringify({ version: 1,
      installation: { installationId: installed.profile.installationId, stagingRoot: root,
        expectedDaemonId: 'synthetic-initialization', agentContainer: 'synthetic-agent', agentImageId: `sha256:${'c'.repeat(64)}`, user },
      dockerSocket: join(root, 'unused.sock'), journalDirectory, credentialFile, minimumFreeBytes: 0, configuration: pool,
      providers: { inputRoot, secretBindings: [] }, engines: [{ manifest: installed.manifest,
        profile: { ...installed.profile, user, stagingRoot: root }, configVersion: 1, manifestId, profileId, catalogVersion }],
    }), { mode: 0o600 });
    const actual = await initializeFreshInstallation({ configPath, uid, gid });
    // The alternate config path proves this helper does not invent a fixture-local path.
    expect(actual.journalPath).toBe(join(journalDirectory, 'journal.sqlite'));
    expect(actual.gatePath).toBe(installationStatePath(actual.journalPath));
    const journal = await openJournal({ path: actual.journalPath, workerUrl: initializationWorkerUrl() });
    const serving = openServingState(actual.gatePath);
    try {
      expect(await journal.journalAuthority()).toBe(actual.journalAuthority);
      expect(serving.journalAuthority).toBe(actual.journalAuthority);
      serving.assertJournalAuthority(await journal.journalAuthority());
      expect(() => serving.assertJournalAuthority('00000000-0000-4000-8000-000000000099')).toThrow();
    } finally { serving.close(); await journal.close(); }
    for (const path of [actual.journalPath, actual.gatePath]) {
      const stat = await lstat(path);
      expect(stat.uid).toBe(uid); expect(stat.gid).toBe(gid); expect(stat.mode & 0o777).toBe(0o600);
    }
    const gate = new DatabaseSync(actual.gatePath, { readOnly: true });
    try { expect(gate.prepare('SELECT phase,authority FROM installation_state LIMIT 2').all())
      .toEqual([{ phase: 'ready', authority: actual.journalAuthority }]); } finally { gate.close(); }
    await expect(initializeFreshInstallation({ configPath, uid, gid })).rejects.toThrow('initialization failed');
    const reopened = openServingState(actual.gatePath);
    try { expect(reopened.journalAuthority).toBe(actual.journalAuthority); } finally { reopened.close(); }
  } finally { vi.unstubAllEnvs(); await rm(root, { recursive: true, force: true }); }
});
