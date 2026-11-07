import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';
import { prepareDispatch } from './dispatch.js';
import { digest, packetDigest } from './digest.js';
import type { TaskPacket } from './types.js';
const execute = promisify(execFile);

it('uses real worktree state and refuses branch/base spoofing or missing design inputs', async () => {
  const root = await mkdtemp(join(tmpdir(), 'beetle-git-preflight-'));
  const git = async (...args: string[]) => (await execute('git', ['-C', root, ...args], { timeout: 10000 })).stdout.trim();
  try {
    await git('init', '-b', 'rewrite/fixture');
    await writeFile(join(root, 'AGENTS.md'), 'Synthetic scoped rules.');
    await git('add', 'AGENTS.md');
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Fixture');
    const base = await git('rev-parse', 'HEAD');
    const packet: TaskPacket = { packetVersion: 1, taskId: 'git-fixture', worktree: root,
      baseCommit: base, contractCommit: base, branch: 'rewrite/fixture', model: 'gpt-6.1-sol', role: 'worker',
      requiredTools: ['exec_command'], locks: [], allowedWrites: ['app/src/domain/**'],
      requiredReads: [{ path: 'AGENTS.md', sha256: digest('Synthetic scoped rules.') }],
      dependencyCommits: [], acceptanceIds: ['V01'], purpose: 'Actual source binding',
      reportPath: '.agent-work/reports/git-fixture/result.md', packetHash: '' };
    packet.packetHash = packetDigest(packet);
    const ledger = { acceptedCommits: [base], revokedHashes: [], active: [] };
    const environment = { availableModels: ['gpt-6.1-sol'], availableTools: ['exec_command'] };
    await expect(prepareDispatch(packet, root, ledger, environment)).resolves.toEqual(packet);
    const spoofed = { ...packet, branch: 'rewrite/other' }; spoofed.packetHash = packetDigest(spoofed);
    await expect(prepareDispatch(spoofed, root, ledger, environment)).rejects.toThrow('base/branch');
    await writeFile(join(root, 'untracked.md'), 'Missing design snapshot');
    await expect(prepareDispatch(packet, root, ledger, environment)).rejects.toThrow('dirty inputs');
    await git('add', 'untracked.md');
    await git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', 'commit', '-m', 'Unaccepted fixture');
    packet.baseCommit = await git('rev-parse', 'HEAD'); packet.packetHash = packetDigest(packet);
    await expect(prepareDispatch(packet, root, ledger, environment)).rejects.toThrow('Unaccepted dependency');
    const correctionLedger = { ...ledger, correctionPackets: [packet.packetHash] };
    await expect(prepareDispatch(packet, root, correctionLedger, environment)).resolves.toEqual(packet);
    await expect(prepareDispatch(packet, root, { ...correctionLedger, revokedHashes: [packet.packetHash] }, environment))
      .rejects.toThrow('Revoked');
  } finally { await rm(root, { recursive: true, force: true }); }
});
