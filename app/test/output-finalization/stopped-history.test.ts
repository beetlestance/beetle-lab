import { captureSettlementRequest, settlementRequestDigest } from '@beetle/contracts/output-settlement';
import type { OutputCleanupAck } from '../../src/ports/output-deletion-metadata.js';
import type { BackendSettlementResult } from '../../src/ports/output-settlement-metadata.js';
import { command, scope } from '../output-deletion/fixture.js';
import { cleaned, hash } from '../output-deletion/cleanup-ack/fixture.js';
import { expect, it } from 'vitest';
import type { OutputFinalizationRequest } from '../../src/ports/output-finalization.js';
import { RunArtifacts } from '../../src/adapters/outbound/sqlite/run-artifacts/index.js';
import { observed } from '../output-absence/stopped-history-fixture.js';
import { finalizationFixture } from './fixture.js';

type Fixture = ReturnType<typeof finalizationFixture>;
function finish(f: Fixture, stoppedHistory: OutputFinalizationRequest['stoppedHistory']) {
  return f.finalizations.execute({
    kind: 'outputFinalize',
    request: { ...f.command(), ...(stoppedHistory === undefined ? {} : { stoppedHistory }) },
  });
}
function fixture(maximum = 10_000) {
  const f = finalizationFixture({
    maximum,
    result: (value) => ({
      ...value,
      completeness: 'missing',
      outcome: 'inconclusive',
      execution: { status: 'error', reason: 'engine_crash', exitCode: null, stoppedAt: '2026-01-01T00:00:00Z' },
      requiredAssertions: { required: 2, passed: 0, failed: 0, unknown: 2 },
      thresholds: [],
    }),
  });
  f.adopt();
  f.release({ exitEvidence: { exitCode: 137, oomKilled: true, observedAt: '2026-01-01T00:01:00Z' } });
  f.ingest();
  return f;
}
const retained = (f: Fixture) => f.db.prepare('SELECT * FROM execution_source_stopped_history').all();

it('waits for exact ACK and settles the verified report and sampled history in one receipt', () => {
  const f = fixture();
  expect(finish(f, 'fetch')).toEqual({ kind: 'pending', reason: 'events' });
  f.confirm();
  expect(finish(f, 'fetch')).toEqual({ kind: 'pending', reason: 'history' });
  const { retained_payload_bytes: base } = f.db
    .prepare('SELECT retained_payload_bytes FROM output_finalization_evidence')
    .get()!;
  const observation = observed(f);
  const charged = f.usage();
  const closed = finish(f, { finalAgentSeq: f.envelope.closure.finalAgentSeq, observation });
  const bytes = Number(base) + observation.bytes;
  expect(closed).toMatchObject({
    kind: 'finalized',
    receipt: { state: 'errored', reason: 'memory_limit', retainedPayloadBytes: bytes, refundedBytes: 10_000 - bytes },
  });
  expect(retained(f)).toEqual([
    expect.objectContaining({
      source_digest: f.envelope.sourceDigest,
      digest: observation.digest,
      canonical_json: observation.json,
      bytes: observation.bytes,
    }),
  ]);
  const read = new RunArtifacts(f.db, f.reads);
  const { organizationId, workspaceId, attemptId } = f.binding.key.attempt;
  expect(
    read.execute({
      kind: 'getRunStoppedHistory',
      key: { id: f.binding.key.runId, scope: { kind: 'workspace', organizationId, workspaceId }, attemptId },
    }),
  ).toEqual(JSON.parse(observation.json));
  expect(finish(f, 'fetch')).toEqual(closed);
  expect(f.usage()).toBe(charged - (10_000 - bytes));
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});

it('rejects an observation from a stale final sequence and permits a verified null observation', () => {
  const f = fixture();
  f.confirm();
  expect(() => finish(f, { finalAgentSeq: 1, observation: observed(f) })).toThrow();
  expect(retained(f)).toEqual([]);
  expect(finish(f, { finalAgentSeq: f.envelope.closure.finalAgentSeq, observation: null })).toMatchObject({
    kind: 'finalized',
    receipt: { reason: 'memory_limit' },
  });
  expect(retained(f)).toEqual([]);
});

it('does not request history for a complete source', () => {
  const f = finalizationFixture();
  f.ready();
  expect(finish(f, 'fetch')).toMatchObject({ kind: 'finalized' });
  expect(retained(f)).toEqual([]);
});

it('purges the source history with its exact charge and replays settlement without refunding it twice', () => {
  const f = fixture();
  f.confirm();
  const observation = observed(f);
  const closed = finish(f, { finalAgentSeq: f.envelope.closure.finalAgentSeq, observation });
  if (closed.kind !== 'finalized') throw new Error('Expected the source to finalize');
  const deletion = command(f);
  expect(f.store.execute({ kind: 'beginOutputDeletion', command: deletion })).toMatchObject({
    retainedPayloadBytes: closed.receipt.retainedPayloadBytes,
  });
  const key = { scope, id: deletion.id, runId: f.key.runId };
  const retirement = f.store.execute({ kind: 'getOutputRetirementRequest', key });
  if (!retirement || !('closure' in retirement) || !('purpose' in retirement)) throw new Error('Missing retirement');
  const ack = f.store.execute({
    kind: 'recordOutputCleanupAck',
    request: { key, reply: cleaned(retirement) },
  }) as OutputCleanupAck;
  const request = captureSettlementRequest({ version: 1, retirement, cleanupReplyDigest: ack.replyDigest });
  const agentReply = {
    version: 1 as const,
    state: 'settled' as const,
    requestDigest: settlementRequestDigest(request, hash),
    cleanupReplyDigest: request.cleanupReplyDigest,
    tombstoneDigest: 'd'.repeat(64),
    chargedBytes: 4096 as const,
  };
  const before = f.usage();
  const operation = { kind: 'settleBackendOutput' as const, request: { key, agentReply } };
  const result = f.store.execute(operation) as BackendSettlementResult;
  expect(result.kind).toBe('source');
  expect(retained(f)).toEqual([]);
  expect(f.usage()).toBe(before - result.refundedBytes);
  expect(f.store.execute(operation)).toEqual(result);
  expect(f.usage()).toBe(before - result.refundedBytes);
  expect(f.db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
});
