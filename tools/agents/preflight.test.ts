import { mkdtemp, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { digest, packetDigest } from './digest.js';
import { auditWrites, preflight } from './preflight.js';
import type { DispatchState, TaskPacket } from './types.js';
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'beetle-packet-')); roots.push(root);
  await writeFile(join(root, 'AGENTS.md'), 'Scoped rules.');
  const packet: TaskPacket = { packetVersion: 1, taskId: 'test-packet', worktree: root, requiredTools: ['exec_command'], locks: ['app-domain'], baseCommit: 'a'.repeat(40),
    contractCommit: 'a'.repeat(40), branch: 'rewrite/test-packet', model: 'gpt-6.1-sol', role: 'worker',
    allowedWrites: ['app/src/domain/**'], requiredReads: [{ path: 'AGENTS.md', sha256: digest('Scoped rules.') }],
    dependencyCommits: [], acceptanceIds: ['V01'], purpose: 'One behavior',
    reportPath: '.agent-work/reports/test-packet/result.md', packetHash: '' };
  packet.packetHash = packetDigest(packet);
  const state: DispatchState = { head: packet.baseCommit, branch: packet.branch,
    acceptedCommits: new Set([packet.contractCommit]), availableModels: ['gpt-6.1-sol'], dirtyPaths: [] };
  return { root, packet, state };
}
describe('task packet boundary', () => {
  it('accepts exact committed inputs and detects later context drift', async () => {
    const { root, packet, state } = await fixture();
    await expect(preflight(packet, root, state)).resolves.toEqual(packet);
    await writeFile(join(root, 'AGENTS.md'), 'Changed rules.');
    await expect(preflight(packet, root, state)).rejects.toThrow('Stale context');
  });
  it('rejects stale base, dirty inputs, missing dependency and unavailable model', async () => {
    const { root, packet, state } = await fixture();
    for (const override of [{ head: 'b'.repeat(40) }, { dirtyPaths: ['untracked.md'] },
      { acceptedCommits: new Set<string>() }, { availableModels: [] }]) {
      await expect(preflight(packet, root, { ...state, ...override })).rejects.toThrow();
    }
  });
  it('rejects tampering, missing documents and symlink escape', async () => {
    const { root, packet, state } = await fixture();
    await expect(preflight({ ...packet, purpose: 'Different' }, root, state)).rejects.toThrow('digest mismatch');
    await rm(join(root, 'AGENTS.md'));
    await expect(preflight(packet, root, state)).rejects.toThrow();
    const outside = await mkdtemp(join(tmpdir(), 'beetle-outside-')); roots.push(outside);
    await writeFile(join(outside, 'rules.md'), 'Scoped rules.');
    await symlink(join(outside, 'rules.md'), join(root, 'AGENTS.md'));
    await expect(preflight(packet, root, state)).rejects.toThrow('escapes');
  });
  it('permits only the exact coordinator-approved correction packet without accepting its baseline as a dependency', async () => {
    const { root, packet, state } = await fixture();
    packet.baseCommit = 'b'.repeat(40); packet.packetHash = packetDigest(packet);
    const correction = { ...state, head: packet.baseCommit, correctionPackets: new Set([packet.packetHash]) };
    await expect(preflight(packet, root, { ...correction, correctionPackets: new Set() })).rejects.toThrow('Unaccepted');
    await expect(preflight(packet, root, correction)).resolves.toEqual(packet);
    const tampered = { ...packet, allowedWrites: ['agent/**'] }; tampered.packetHash = packetDigest(tampered);
    await expect(preflight(tampered, root, correction)).rejects.toThrow('Unaccepted');
    packet.dependencyCommits.push(packet.baseCommit); packet.packetHash = packetDigest(packet);
    await expect(preflight(packet, root, { ...correction, correctionPackets: new Set([packet.packetHash]) })).rejects.toThrow('Unaccepted dependency');
  });
  it.each(['../foreign/**', '/tmp/**', '.git/**', '**/*', 'configs/**', '.env'])('rejects unsafe scope %s', async path => {
    const { root, packet, state } = await fixture(); packet.allowedWrites = [path]; packet.packetHash = packetDigest(packet);
    await expect(preflight(packet, root, state)).rejects.toThrow('Unsafe write');
  });
  it('audits writes independently and prevents reviewers granting themselves mutation scope', async () => {
    const { root, packet, state } = await fixture();
    expect(() => auditWrites(packet, ['app/src/domain/outcome.ts'])).not.toThrow();
    expect(() => auditWrites(packet, ['package-lock.json'])).toThrow('Out-of-scope');
    expect(() => auditWrites(packet, ['app/src/domain/../../package.json'])).toThrow('Unsafe changed');
    packet.role = 'reviewer'; packet.packetHash = packetDigest(packet);
    await expect(preflight(packet, root, state)).rejects.toThrow('Reviewer cannot write');
  });
});
