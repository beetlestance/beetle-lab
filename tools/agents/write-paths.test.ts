import { mkdtemp, mkdir, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { checkWritePaths } from './write-paths.js';
import { preflight } from './preflight.js';
import { digest, packetDigest } from './digest.js';
import type { TaskPacket } from './types.js';

it('rejects write symlinks and reads resolving into forbidden metadata before reading it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beetle-paths-'));
  try {
    await mkdir(join(root, 'owned'));
    await symlink(join(root, 'owned'), join(root, 'foreign'));
    await expect(checkWritePaths(root, ['owned/new/file.ts'])).resolves.toBeUndefined();
    await expect(checkWritePaths(root, ['foreign/new/file.ts'])).rejects.toThrow('Symlink');
    await writeFile(join(root, '.env'), 'SYNTHETIC_SECRET_CANARY');
    await symlink(join(root, '.env'), join(root, 'AGENTS.md'));
    const packet: TaskPacket = { packetVersion: 1, taskId: 'path-fixture', worktree: root,
      baseCommit: 'a'.repeat(40), contractCommit: 'a'.repeat(40), branch: 'rewrite/fixture',
      model: 'gpt-6.1-sol', role: 'worker', requiredTools: [], locks: [], allowedWrites: ['owned/**'],
      requiredReads: [{ path: 'AGENTS.md', sha256: digest('SYNTHETIC_SECRET_CANARY') }], dependencyCommits: [],
      acceptanceIds: ['V16'], purpose: 'Reject forbidden target', reportPath: '.agent-work/reports/path-fixture/result.md', packetHash: '' };
    packet.packetHash = packetDigest(packet);
    const state = { head: packet.baseCommit, branch: packet.branch, acceptedCommits: new Set([packet.baseCommit]),
      availableModels: [packet.model], dirtyPaths: [] };
    await expect(preflight(packet, root, state)).rejects.toThrow('forbidden path');
  } finally { await rm(root, { recursive: true, force: true }); }
});
