import { expect, it, vi } from 'vitest';
import { chmod, mkdtemp, readFile, realpath, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { encodeCanonicalJson, validate } from '@beetle/contracts';
import { openOutputRuntime } from '../../src/bootstrap/output-runtime/index.js';
import { createRunnerGateway } from '../../src/adapters/outbound/runner/index.js';
import { prepareCancelRunCommand } from '../../src/application/runs/index.js';
import { EVENT_ROW_ALLOWANCE } from '../../src/ports/events.js';
import { storageFixture, digest, requestId } from '../storage/fixture.js';
import { ack, request } from '../storage/events/fixtures.js';
import { binary, descriptor, peer, seeded, sha } from '../output-transfer/peer-fixture.js';

const storage = storageFixture();

it.each([false, true])('automatically publishes and durably settles with real metadata/native files, cancellation=%s', async cancelled => {
  const bytes = binary(); const empty = Buffer.alloc(0);
  const f = seeded([descriptor(bytes), descriptor(empty, 1)]); const path = storage.path();
  const envelope = { ...f.envelope, closure: { ...f.envelope.closure, finalAgentSeq: 2 } };
  const header = f.db.prepare('SELECT snapshot_json FROM execution_records WHERE attempt_id=?').get(f.binding.key.attempt.attemptId);
  if (typeof header?.snapshot_json !== 'string') throw new Error('Missing synthetic retained header');
  const released = validate('AttemptSnapshot', { ...JSON.parse(header.snapshot_json), state: 'exited', lastSeq: 2,
    admission: { state: 'released', disposition: 'settled' },
    exitEvidence: { exitCode: 0, oomKilled: false, observedAt: '2026-01-01T00:01:00Z' } });
  if (!released.ok) throw new Error('Invalid synthetic release');
  f.db.prepare('VACUUM INTO ?').run(path); f.db.close();
  let metadata = await storage.open(path, { runs: f.config });
  const root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-output-settlement-'))); await chmod(root, 0o700);
  const remote = await peer(envelope, [bytes, empty]); const gateway = createRunnerGateway(remote.loaded);
  const failures: unknown[] = []; const a = f.binding.key.attempt;
  const key = { id: f.binding.key.runId, scope: { kind: 'workspace' as const,
    organizationId: a.organizationId, workspaceId: a.workspaceId } };
  const before = await metadata.runs.getRun(key);
  const charged = (await metadata.inputs.storage()).chargedBytes;
  const runtime = await openOutputRuntime({ dataRoot: root, outputs: metadata.outputs, runs: metadata.runs, gateway,
    finalizations: metadata.finalizations, freeSpaceReserveBytes: 0, intervalMs: 25,
    onFailure: async error => { failures.push(error); } });
  try {
    await vi.waitFor(async () => {
      const value = await metadata.outputs.load(f.binding);
      expect(value.kind === 'adopted' && value.artifacts.every(artifact => artifact.phase === 'published')).toBe(true);
    }, { timeout: 5000, interval: 25 });
    // Real publication alone must neither finalize nor refund the original hold.
    expect((await metadata.runs.getRun(key)).outcome).toBe('pending');
    expect((await metadata.inputs.storage()).chargedBytes).toBe(charged);
    const state = await metadata.outputs.load(f.binding);
    if (state.kind !== 'adopted') throw new Error('Missing published source');
    for (const [ordinal, expected] of [bytes, empty].entries()) {
      const artifact = state.artifacts[ordinal]!;
      const actual = await readFile(join(root, 'outputs/published', a.organizationId, a.workspaceId,
        key.id, a.attemptId, artifact.token));
      expect(actual).toEqual(expected); expect(sha(actual)).toBe(sha(expected));
    }
    if (cancelled) {
      await metadata.runs.cancel(prepareCancelRunCommand({ kind: 'cancelRun', id: key.id,
        request: { scope: key.scope, requestId: requestId() } }, digest));
    }
    const batch = request(f.binding, 0, 2);
    await metadata.events.ingest(batch);
    await metadata.events.confirmAck({ binding: f.binding, throughSeq: 2, receipt: ack(f.binding, 2) });
    await metadata.dispatch.observe({ key: f.binding.key, journalAuthority: f.binding.journalAuthority, snapshot: released.value });
    await vi.waitFor(async () => expect(await metadata.runs.getRun(key)).toMatchObject({
      state: cancelled ? 'cancelled' : 'finished', outcome: cancelled ? 'inconclusive' : 'passed',
      reason: cancelled ? 'cancelled' : null, validationStatus: 'passed',
    }), { timeout: 5000, interval: 25 });
    const terminal = await metadata.runs.getRun(key);
    const command = { binding: f.binding, sourceDigest: envelope.sourceDigest,
      manifestDigest: envelope.manifest.manifestDigest, expectedRunVersion: before.version };
    const receipt = await metadata.finalizations.finalize(command);
    const retained = batch.batch.events.reduce((sum, event) => sum + Buffer.byteLength(encodeCanonicalJson(event, 4096))
      + EVENT_ROW_ALLOWANCE, 0) + Buffer.byteLength(encodeCanonicalJson(envelope.manifest, 73728)) + bytes.length;
    expect(receipt).toMatchObject({ kind: 'finalized', receipt: {
      retainedPayloadBytes: retained, refundedBytes: before.budget.outputBytes - retained, runVersion: terminal.version,
    } });
    expect((await metadata.inputs.storage()).chargedBytes).toBe(charged - before.budget.outputBytes + retained);
    expect(await metadata.outputs.scan({ limit: 32 })).toEqual({ items: [], nextCursor: null });
    expect((await metadata.results.getRunResult(key)).result).toEqual(envelope.manifest.result);
    expect(remote.unexpected).toEqual([]); expect(failures).toEqual([]);
    await runtime.close(); await storage.close(metadata);
    metadata = await storage.open(path, { runs: f.config });
    expect(await metadata.finalizations.finalize(command)).toEqual(receipt);
    expect(await metadata.runs.getRun(key)).toEqual(terminal);
    expect((await metadata.inputs.storage()).chargedBytes).toBe(charged - before.budget.outputBytes + retained);
  } finally {
    await runtime.close(); await gateway.close(); await remote.close(); await storage.close(metadata);
    await rm(root, { recursive: true, force: true });
  }
});
