import { expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openOutputRuntime } from '../../src/bootstrap/output-runtime/index.js';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import type { OutputFinalizationRequest } from '../../src/ports/output-finalization.js';
import { storageFixture } from '../storage/fixture.js';
import { binary, descriptor, peer, seeded, sha } from '../output-transfer/peer-fixture.js';

const storage = storageFixture();
it('automatically publishes through compiled metadata, native roots and real HTTP; controlled finalization stays pending', async () => {
  const bytes = binary(); const f = seeded([descriptor(bytes)]); const path = storage.path();
  f.db.prepare('VACUUM INTO ?').run(path); f.db.close();
  const metadata = await storage.open(path, {runs: f.config});
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-output-composed-'))); await chmod(root, 0o700);
  const remote = await peer(f.envelope, [bytes]); const gateway = createRunnerGateway(remote.loaded);
  const failures: unknown[] = [];
  const finalize = vi.fn(async (request: OutputFinalizationRequest) => {
    const state = await metadata.outputs.load(request.binding);
    expect(state).toMatchObject({kind: 'adopted', binding: f.binding, sourceDigest: f.envelope.sourceDigest,
      manifestDigest: f.envelope.manifest.manifestDigest});
    if (state.kind !== 'adopted') throw new Error('Missing adopted source');
    expect(state.artifacts).toHaveLength(1); expect(state.artifacts[0]).toMatchObject({phase: 'published', writer: null, offset: bytes.length});
    return {kind: 'pending' as const, reason: 'events' as const};
  });
  let runtime = await openOutputRuntime({dataRoot: root, outputs: metadata.outputs, runs: metadata.runs, gateway,
    finalizations: {finalize}, freeSpaceReserveBytes: 0, intervalMs: 25, onFailure: async error => {failures.push(error);}});
  try {
    await vi.waitFor(() => expect(finalize.mock.calls.length).toBeGreaterThan(0), {timeout: 5000, interval: 25});
    const state = await metadata.outputs.load(f.binding); if (state.kind !== 'adopted') throw new Error('Missing native publication');
    const artifact = state.artifacts[0]!; const attempt = f.binding.key.attempt;
    const actual = await readFile(join(root, 'outputs/published', attempt.organizationId, attempt.workspaceId,
      f.binding.key.runId, attempt.attemptId, artifact.token));
    expect(actual).toEqual(bytes); expect(sha(actual)).toBe(artifact.sha256);
    const calls = remote.selectors.length; const token = artifact.token;
    await runtime.close();
    runtime = await openOutputRuntime({dataRoot: root, outputs: metadata.outputs, runs: metadata.runs, gateway,
      finalizations: {finalize}, freeSpaceReserveBytes: 0, intervalMs: 25, onFailure: async error => {failures.push(error);}});
    const before = finalize.mock.calls.length;
    await vi.waitFor(() => expect(finalize.mock.calls.length).toBeGreaterThan(before), {timeout: 5000, interval: 25});
    const reopened = await metadata.outputs.load(f.binding); expect(reopened).toMatchObject({artifacts: [{token, phase: 'published', writer: null}]});
    expect(remote.selectors).toHaveLength(calls); expect(remote.unexpected).toEqual([]); expect(failures).toEqual([]);
    expect(runtime.state().status).toBe('running');
    // Controlled finalization never mutates the actual Run or claims terminal projection.
    const run = await metadata.runs.getRun({id: f.binding.key.runId, scope: {kind: 'workspace',
      organizationId: attempt.organizationId, workspaceId: attempt.workspaceId}});
    expect(['finished', 'cancelled', 'errored']).not.toContain(run.state);
  } finally {
    await runtime.close(); await gateway.close(); await remote.close(); await storage.close(metadata);
    await rm(root, {recursive: true, force: true});
  }
});
