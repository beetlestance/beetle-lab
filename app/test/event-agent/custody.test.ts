import { expect, it } from 'vitest';
import type { EventBinding } from '../../src/ports/events.js';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import type { RunnerGateway } from '../../src/ports/runner.js';
import { collectEvents } from '../../src/adapters/outbound/runner/events/index.js';
import { prepareEventBatch } from '../../src/domain/events/index.js';
import { scope } from '../storage/fixture.js';
import { agentHttpFixture } from './http-fixture.js';
import { agentProcessFixture } from './agent-fixture.js';
import { appendEvents, configured, inspectBackend, metadataFixture } from './storage-fixture.js';

const backend = metadataFixture();
const journals = agentProcessFixture(backend.root);
const peers = agentHttpFixture();
function collect(metadata: Metadata, gateway: RunnerGateway, binding: EventBinding) {
  return collectEvents({ store: metadata.events, attempt: gateway.attempt,
    signal: new AbortController().signal, stopped: () => false }, binding);
}
function ack(binding: EventBinding, throughSeq = 2) {
  const { attemptId, organizationId, workspaceId, generation } = binding.key.attempt;
  return { protocolVersion: '1.0' as const, attemptId, organizationId, workspaceId, generation, throughSeq };
}
const eventsPath = (binding: EventBinding, after: number) => `GET /runner/v1/attempts/${binding.key.attempt.attemptId}/events?after=${after}`;
const ackPath = (binding: EventBinding) => `POST /runner/v1/attempts/${binding.key.attempt.attemptId}/ack`;

it('collects actual Journal events over agent TCP, durably ACKs, and retains exact rows and allocation after prune', async () => {
  const journalPath = journals.path(); const journal = await journals.open(journalPath);
  const f = await backend.start(journal); const { metadata, binding } = f;
  const events = await appendEvents(journal, binding);
  const batch = await journal.readEvents(binding.key.attempt, 0);
  expect(batch.events).toEqual(events);
  const expected = prepareEventBatch({ binding, after: 0, batch }).records;
  const charge = expected.reduce((sum, record) => sum + record.chargedBytes, 0);
  const runBefore = await metadata.runs.getRun({ id: binding.key.runId, scope });
  const peer = await peers(journal);
  await collect(metadata, peer.gateway, binding);
  const stored = await metadata.events.load(binding);
  expect(stored).toMatchObject({ durableThrough: 2, ackConfirmedThrough: 2, eventCount: 2,
    retainedBytes: charge, blockedReason: null, coverage: 'contiguous' });
  expect((await peer.traffic()).receipts).toMatchObject([{ acknowledgedSeq: 2, attemptId: binding.key.attempt.attemptId }]);
  expect(await journal.prune(binding.key.attempt)).toMatchObject({ pruned: 2, snapshot: { lastSeq: 2, retainedStartSeq: 3 } });
  await expect(journal.readEvents(binding.key.attempt, 0)).rejects.toMatchObject({ code: 'cursor_expired' });
  await collect(metadata, peer.gateway, binding);
  expect(await metadata.events.load(binding)).toEqual(stored);
  expect((await peer.traffic()).requests).toEqual([eventsPath(binding, 0), ackPath(binding), eventsPath(binding, 2)]);
  expect(await metadata.runs.getRun({ id: binding.key.runId, scope })).toEqual(runBefore);
  await peer.close(); await backend.close(metadata);
  const journalState = await journal.inspect(); await journals.close(journal);
  const persisted = inspectBackend(f.path);
  expect(persisted.rows).toEqual(expected.map(record => ({ seq: record.seq, canonical_json: record.canonical, charged_bytes: record.chargedBytes })));
  expect(persisted.custody).toEqual(f.baseline.custody); expect(persisted.foreignKeys).toEqual([]);
  expect(journalState).toEqual({ rows: [], attempts: [{ attempt_id: binding.key.attempt.attemptId,
    last_seq: 2, acknowledged_seq: 2, retained_start_seq: 3, spool_rows: 0, spool_bytes: 0 }] });
});

it('loses an applied real ACK response, prunes, and reopens both original paths to re-ACK without GET', async () => {
  const journalPath = journals.path(); let journal = await journals.open(journalPath);
  const f = await backend.start(journal); let metadata = f.metadata; const { binding } = f;
  await appendEvents(journal, binding);
  const batch = await journal.readEvents(binding.key.attempt, 0);
  const expected = prepareEventBatch({ binding, after: 0, batch }).records;
  const charge = expected.reduce((sum, record) => sum + record.chargedBytes, 0);
  let peer = await peers(journal);
  await peer.configure({ loseAck: true, commitPath: f.path + '.commit-observed' });
  const runBefore = await metadata.runs.getRun({ id: binding.key.runId, scope });
  await collect(metadata, peer.gateway, binding);
  const traffic = await peer.traffic(); const observations = traffic.observations;
  expect(traffic.receipts).toHaveLength(1);
  expect(traffic.receipts[0]?.acknowledgedSeq).toBe(2);
  expect(observations).toEqual([{ cursor: { attempt_id: binding.key.attempt.attemptId,
    durable_through: 2, event_count: 2, retained_bytes: charge }, rows: { n: 2, bytes: charge } }]);
  const stored = await metadata.events.load(binding);
  expect(stored).toMatchObject({ durableThrough: 2, ackConfirmedThrough: 0, eventCount: 2, retainedBytes: charge });
  expect(await journal.prune(binding.key.attempt)).toMatchObject({ pruned: 2, snapshot: { retainedStartSeq: 3 } });
  expect((await peer.traffic()).requests).toEqual([eventsPath(binding, 0), ackPath(binding)]);
  await peer.close(); await backend.close(metadata);
  const beforeJournal = await journal.inspect(); await journals.close(journal);
  const beforeRestart = inspectBackend(f.path);
  expect(beforeJournal.attempts).toMatchObject([{ acknowledged_seq: 2, retained_start_seq: 3, spool_rows: 0 }]);
  journal = await journals.open(journalPath);
  expect(await journal.journalAuthority()).toBe(binding.journalAuthority);
  metadata = await f.reopen();
  expect(await metadata.events.load(binding)).toEqual(stored);
  peer = await peers(journal);
  await peer.configure({ loseAck: false, commitPath: f.path + '.commit-observed' });
  await collect(metadata, peer.gateway, binding);
  const resumed = await peer.traffic();
  expect(resumed.requests).toEqual([ackPath(binding)]);
  expect(resumed.receipts).toMatchObject([{ acknowledgedSeq: 2 }]);
  expect(resumed.observations).toHaveLength(1); expect(resumed.observations[0]).toEqual(observations[0]);
  expect(await metadata.events.load(binding)).toEqual({ ...stored, ackConfirmedThrough: 2 });
  expect(await metadata.runs.getRun({ id: binding.key.runId, scope })).toEqual(runBefore);
  expect(await metadata.dispatch.claim(binding.key)).toEqual({ kind: 'acknowledged', journalAuthority: binding.journalAuthority });
  await peer.close(); await backend.close(metadata);
  const afterJournal = await journal.inspect(); await journals.close(journal);
  const persisted = inspectBackend(f.path);
  expect(persisted.rows).toEqual(expected.map(record => ({ seq: record.seq, canonical_json: record.canonical, charged_bytes: record.chargedBytes })));
  expect(persisted.rows).toEqual(beforeRestart.rows); expect(persisted.custody).toEqual(f.baseline.custody);
  expect(persisted.cursors).toMatchObject([{ durable_through: 2, ack_confirmed_through: 2, event_count: 2, retained_bytes: charge }]);
  expect(afterJournal).toEqual({ rows: [], attempts: [{ attempt_id: binding.key.attempt.attemptId,
    last_seq: 2, acknowledged_seq: 2, retained_start_seq: 3, spool_rows: 0, spool_bytes: 0 }] });
});

it('records genuine actual-journal cursor expiry as partial without inventing local rows, ACK or outcome', async () => {
  const journalPath = journals.path(); const journal = await journals.open(journalPath);
  const f = await backend.start(journal); const { metadata, binding } = f;
  await appendEvents(journal, binding);
  // A separate synthetic prior consumer owns this real ACK; this backend has no prefix.
  await journal.acknowledge(ack(binding));
  expect(await journal.prune(binding.key.attempt)).toMatchObject({ pruned: 2, snapshot: { retainedStartSeq: 3 } });
  const peer = await peers(journal);
  const runBefore = await metadata.runs.getRun({ id: binding.key.runId, scope });
  await collect(metadata, peer.gateway, binding);
  const partial = await metadata.events.load(binding);
  expect(partial).toMatchObject({ durableThrough: 0, ackConfirmedThrough: 0, eventCount: 0,
    retainedBytes: 0, coverage: 'partial', blockedReason: 'cursor_expired', retainedStartSeq: 3 });
  await collect(metadata, peer.gateway, binding);
  expect(await metadata.events.load(binding)).toEqual(partial);
  const traffic = await peer.traffic();
  expect(traffic.requests).toEqual([eventsPath(binding, 0)]);
  expect(traffic.statuses).toEqual([409]); expect(traffic.receipts).toEqual([]);
  expect(await metadata.runs.getRun({ id: binding.key.runId, scope })).toEqual(runBefore);
  await peer.close(); await backend.close(metadata);
  const journalState = await journal.inspect(); await journals.close(journal);
  const persisted = inspectBackend(f.path);
  expect(persisted.rows).toEqual([]); expect(persisted.custody).toEqual(f.baseline.custody);
  expect(persisted.cursors).toMatchObject([{ durable_through: 0, ack_confirmed_through: 0, coverage: 'partial', blocked_reason: 'cursor_expired' }]);
  expect(journalState.attempts).toMatchObject([{ acknowledged_seq: 2, retained_start_seq: 3, spool_rows: 0 }]);
});

it.each(['absent', 'expired'] as const)('fences a different actual physical journal with %s history without adoption or false diagnostics', async history => {
  const original = await journals.open();
  const f = await backend.start(original); const { metadata, binding } = f;
  const replacementPath = journals.path(); const replacement = await journals.open(replacementPath);
  const authority = await replacement.journalAuthority();
  expect(authority).not.toBe(binding.journalAuthority);
  if (history === 'expired') {
    const offer = await metadata.dispatch.readOffer(binding.key);
    await replacement.immutableOffer(offer.offer);
    await appendEvents(replacement, binding); await replacement.acknowledge(ack(binding));
    expect(await replacement.prune(binding.key.attempt)).toMatchObject({ pruned: 2 });
  }
  // Publishing current capacity cannot replace the retained original's physical binding.
  await metadata.updateRuntime(configured(authority).runtime);
  const before = await metadata.events.load(binding);
  const peer = await peers(replacement);
  const currentClient = peer.gateway.attempt({ ...binding.key.attempt, journalAuthority: authority });
  expect(await currentClient.events(0)).toMatchObject({ ok: false, error: { kind: 'protocol',
    status: history === 'absent' ? 404 : 409, protocol: { reason: history === 'absent' ? 'attempt_not_found' : 'cursor_expired' } } });
  const client = peer.gateway.attempt({ ...binding.key.attempt, journalAuthority: binding.journalAuthority });
  expect(await client.events(0)).toMatchObject({ ok: false, error: { kind: 'protocol', status: 409,
    protocol: { reason: 'authority_mismatch' } } });
  await collect(metadata, peer.gateway, binding);
  const traffic = await peer.traffic();
  expect(traffic.statuses).toEqual([history === 'absent' ? 404 : 409, 409, 409]);
  expect(traffic.receipts).toEqual([]);
  expect(await metadata.events.load(binding)).toEqual(before);
  expect(before).toMatchObject({ binding, durableThrough: 0, ackConfirmedThrough: 0,
    coverage: 'contiguous', blockedReason: null, retainedStartSeq: null, eventCount: 0 });
  await expect(metadata.events.load({ ...binding, journalAuthority: authority })).rejects.toMatchObject({ code: 'not_found' });
  expect(await metadata.dispatch.claim(binding.key)).toEqual({ kind: 'acknowledged', journalAuthority: binding.journalAuthority });
  await peer.close(); await backend.close(metadata);
  const replacementState = await replacement.inspect(); await journals.close(replacement);
  const persisted = inspectBackend(f.path);
  expect(persisted.rows).toEqual([]); expect(persisted.custody).toEqual(f.baseline.custody);
  expect(replacementState.attempts).toHaveLength(history === 'absent' ? 0 : 1);
});
