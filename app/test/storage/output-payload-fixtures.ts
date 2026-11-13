import { createHash } from 'node:crypto';
import { encodeCanonicalJson, sealEngineResult } from '@beetle/contracts';
import type { Artifact, AttemptSnapshot, Offer } from '@beetle/contracts';
import { prepareOutputManifest } from '@beetle/contracts/output-source';
import { DispatchObservations } from '../../src/adapters/outbound/sqlite/dispatch-observations.js';
import { RunReads } from '../../src/adapters/outbound/sqlite/run-reads.js';
import { Suites } from '../../src/adapters/outbound/sqlite/suites.js';
import { Entities } from '../../src/adapters/outbound/sqlite/entities.js';
import { afterEach } from 'vitest';
import { claimsFixture } from './dispatch-claim-fixtures.js';
import { acknowledge, reserveAndMark } from './execution-foundation-fixtures.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { EventCustody } from '../../src/adapters/outbound/sqlite/event-custody/index.js';
import { prepareEventBatch } from '../../src/domain/events/index.js';
import { request } from './events/fixtures.js';
import { observation, settingsFixture } from './fixture.js';
const handles = new Set<ReturnType<typeof claimsFixture>>();
afterEach(() => { for (const f of handles) f.db.close(); handles.clear(); });
export interface PayloadOwner {readonly claims:ReturnType<typeof claimsFixture>;readonly id:number}
function foundation(maximum: number, ack: boolean, storageBytes:number, owner?:PayloadOwner) {
  const f = owner?.claims??claimsFixture(storageBytes); handles.add(f);
  f.policy(values => { values.pool.outputBytes = 100000; values.perRunCeilings.outputBytes = 100000; });
  const runtime = observation(settingsFixture().runtime); runtime.ceilings.pool.outputBytes = 100000; runtime.ceilings.perRun.outputBytes = 100000; runtime.ceilings.pool.storageBytes = storageBytes;
  f.store.execute({ kind: 'runtime', runtime });
  const key = f.add(owner?.id??70, 'parallel', 100, maximum);
  transaction(f.db, () => { reserveAndMark(f.db, key); if (ack) acknowledge(f.db, key); });
  const binding = { key, journalAuthority: '33333333-3333-4333-8333-333333333333' };
  const event = () => prepareEventBatch(request(binding)).records[0]!;
  const cursor = () => f.db.prepare('SELECT * FROM event_cursors WHERE attempt_id=?').get(key.attempt.attemptId)!;
  const create = () => new EventCustody(f.db, 'synthetic-installation').load(binding);
  const append = () => {
    const record = event(); f.db.prepare('INSERT INTO run_events VALUES(?,1,1,?,?,?)')
      .run(key.attempt.attemptId, record.canonical, record.chargedBytes, Number(cursor().retained_bytes) + record.chargedBytes);
  };
  return { ...f, key, binding, event, cursor, create, append };
}
import { snapshotFor } from './execution-foundation-fixtures.js';
import { result } from '../domain/run-observation-fixtures.js';
export const hash = (text: string): string => createHash('sha256').update(text).digest('hex');
export const json = (value: unknown): string => encodeCanonicalJson(value, 73_728);
export function payloadFixture(maximum = 10000, ack = true, storageBytes=400000, owner?:PayloadOwner) {
  const f = foundation(maximum, ack, storageBytes,owner);
  const observations = new DispatchObservations(f.db, new RunReads(f.db, new Suites(f.db, new Entities(f.db))));
  const { seal, ...body } = { ...result(), ...f.key.attempt, artifacts: [] }; const { intentDigest, ...scoped } = body; void intentDigest;
  const sealed = sealEngineResult(scoped, seal.sealedAt, hash); if (!sealed.ok) throw new Error('Invalid synthetic result');
  const value = sealed.value;
  const offer = JSON.parse(String(f.db.prepare('SELECT offer_json FROM attempts WHERE id=?').get(f.key.attempt.attemptId)?.offer_json)) as Offer;
  if (!offer.installedIdentity) throw new Error('Missing original installed pin');
  const manifest = (artifacts: Artifact[] = []) => {
    const { seal: old, ...core } = value;
    const next = sealEngineResult({ ...core, artifacts }, old.sealedAt, hash); if (!next.ok) throw new Error('Invalid synthetic result');
    return prepareOutputManifest({ version: 1, binding: { ...f.key.attempt, journalAuthority: f.binding.journalAuthority,
      engine: offer.engine, installedIdentity: offer.installedIdentity!, specDigest: 'b'.repeat(64) }, result: next.value,
      resultFileBytes: 1024, controlBytes: 0, verifiedBytes: 1024 + artifacts.reduce((sum, a) => sum + a.bytes, 0) }, hash);
  };
  const observe = (patch: Partial<AttemptSnapshot> = {}) => observations.observe({ key: f.key, journalAuthority: f.binding.journalAuthority,
    snapshot: snapshotFor(f.key, patch) });
  const carrier = () => f.db.prepare('SELECT * FROM execution_output_payloads').all();
  const facts = () => ['execution_records', 'execution_output_payloads', 'event_cursors', 'run_events', 'attempts', 'dispatch_outbox',
    'runs', 'attempt_output_allocations', 'installation_storage_usage'].map(table => f.db.prepare(`SELECT * FROM ${table}`).all());
  function putManifest(artifacts: Artifact[] = []) {
    const text = json(manifest(artifacts));
    if (carrier().length) f.db.prepare("UPDATE execution_output_payloads SET kind='manifest',canonical_json=? WHERE attempt_id=?").run(text, f.key.attempt.attemptId);
    else f.db.prepare("INSERT INTO execution_output_payloads VALUES(?,'manifest',?)").run(f.key.attempt.attemptId, text);
    return text;
  }
  return { ...f, value, observe, manifest, carrier, facts, putManifest };
}
