import { DatabaseSync } from 'node:sqlite';
import type { AgentEvent } from '@beetle/contracts';
import type { EventBinding } from '../../src/ports/events.js';
import type { Metadata } from '../../src/adapters/outbound/sqlite/index.js';
import type { AgentFixture } from './agent-fixture.js';
import { seed, observation, settingsFixture, storageFixture } from '../storage/fixture.js';
import { append, createSuite } from '../storage/suites-fixture.js';
import { runCommand, runOptions, runRequest } from '../storage/runs-fixture.js';
import { commitProbe } from '../bootstrap/event-commit-probe.js';
import progress from '../../../contracts/fixtures/valid/wrapper-progress.json' with { type: 'json' };

export function configured(authority: string) {
  const values = settingsFixture();
  values.chain.installation.values.pool.storageBytes = 1_000_000;
  values.chain.installation.values.pool.outputBytes = 20_000;
  values.chain.installation.values.perRunCeilings.outputBytes = 10_000;
  values.runtime.pool.storageBytes = 2_000_000;
  values.runtime.pool.outputBytes = 20_000; values.runtime.perRun.outputBytes = 10_000;
  const runtime = { ...observation(values.runtime), journalAuthority: authority };
  return { installation: values.chain.installation, runtime, ...runOptions() };
}

export async function boundOriginal(metadata: Metadata, journal: AgentFixture): Promise<EventBinding> {
  await seed(metadata);
  const revision = await append(metadata, await createSuite(metadata));
  const request = runRequest(revision.id); request.budget.outputBytes = 10_000;
  await metadata.runs.execute(runCommand(revision.id, 70, request));
  const key = (await metadata.dispatch.scan({ lane: 'queued', limit: 1 })).items[0]!.key;
  const authority = await journal.journalAuthority();
  const claim = await metadata.dispatch.claim(key);
  if (claim.kind !== 'claimed' || claim.journalAuthority !== authority) throw new Error('Original not bound to actual journal');
  const original = await metadata.dispatch.readOffer(key);
  const snapshot = await journal.immutableOffer(original.offer);
  await metadata.dispatch.observe({ key, journalAuthority: authority, snapshot });
  return { key, journalAuthority: authority };
}

export async function appendEvents(journal: AgentFixture, binding: EventBinding): Promise<AgentEvent[]> {
  const { attemptId, organizationId, workspaceId, generation } = binding.key.attempt;
  const first = await journal.appendSupervisor({ sourceOrdinal: 1, event: {
    version: '1.0', attemptId, organizationId, workspaceId, generation, phase: 'execute', source: 'agent',
    observedAt: '2026-01-01T00:00:00Z', kind: 'runtime.started', payload: { runtimeId: 'synthetic-seam' },
  } });
  const second = await journal.appendWrapper({ ...progress, version: '1.0', phase: 'execute', kind: 'progress',
    attemptId, organizationId, workspaceId, generation, seq: 1 });
  return [first, second];
}

/** All native inspection happens after the exclusive production owner has closed. */
export function inspectBackend(path: string) {
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    const rows = db.prepare('SELECT seq,canonical_json,charged_bytes FROM run_events ORDER BY seq LIMIT 3').all();
    const custody = ['runs', 'attempts', 'dispatch_outbox', 'execution_records',
      'attempt_output_allocations', 'installation_storage_usage']
      .map(table => db.prepare(`SELECT * FROM ${table} LIMIT 2`).all());
    const cursors = db.prepare('SELECT * FROM event_cursors LIMIT 2').all();
    return { rows, custody, cursors, foreignKeys: db.prepare('PRAGMA foreign_key_check').all() };
  } finally { db.close(); }
}

export function metadataFixture() {
  const fixture = storageFixture();
  return { ...fixture, async start(journal: AgentFixture) {
    const authority = await journal.journalAuthority();
    const path = fixture.path();
    const workerUrl = await commitProbe(fixture.root(), fixture.workerUrl());
    const options = { ...configured(authority), workerUrl };
    let metadata = await fixture.open(path, options);
    const binding = await boundOriginal(metadata, journal);
    await fixture.close(metadata);
    const baseline = inspectBackend(path);
    metadata = await fixture.open(path, { ...options, runtime: null });
    return { metadata, binding, path, baseline,
      reopen: () => fixture.open(path, { ...options, runtime: null }) };
  } };
}
