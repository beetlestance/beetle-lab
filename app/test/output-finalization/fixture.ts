import type { Artifact, AttemptSnapshot, EngineResult } from '@beetle/contracts';
import { sealEngineResult, encodeCanonicalJson } from '@beetle/contracts';
import { prepareOutputManifest } from '@beetle/contracts/output-source';
import { OutputFinalizations } from '../../src/adapters/outbound/sqlite/output-finalization/index.js';
import { EventCustody } from '../../src/adapters/outbound/sqlite/event-custody/index.js';
import { OutputCustody } from '../../src/adapters/outbound/sqlite/output-custody/index.js';
import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { payloadFixture } from '../storage/output-payload-fixtures.js';
import { acknowledge, snapshotFor } from '../storage/execution-foundation-fixtures.js';
import { hash } from '../storage/output-payload-fixtures.js';
import { ack, request } from '../storage/events/fixtures.js';
export { artifact } from '../storage/output-custody-fixtures.js';
export { uuid, scope } from '../storage/fixture.js';
interface Options { events?: number; artifacts?: Artifact[]; result?: (value: EngineResult) => EngineResult }
export function finalizationFixture(options: Options = {}) {
  const count = options.events ?? 2; const f = payloadFixture(10000, count !== 0);
  const exitEvidence = { exitCode: 0, oomKilled: false, observedAt: '2026-01-01T00:01:00Z' };
  if (count === 0) transaction(f.db, () => acknowledge(f.db, f.key, snapshotFor(f.key, {
    state: 'exited', lastSeq: 0, exitEvidence, admission: { state: 'charged' } })));
  const base = f.manifest(options.artifacts ?? []);
  const mutable = JSON.parse(encodeCanonicalJson(base.result, 65536)) as EngineResult;
  const { seal, ...body } = options.result ? options.result(mutable) : mutable;
  const result = sealEngineResult(body, seal.sealedAt, hash); if (!result.ok) throw new Error('Invalid synthetic result');
  const manifest = prepareOutputManifest({ version: 1, binding: base.binding, result: result.value,
    resultFileBytes: base.resultFileBytes, controlBytes: base.controlBytes, verifiedBytes: base.verifiedBytes }, hash);
  const sourceDigest = 'c'.repeat(64);
  const envelope = { version: 1, manifest, sourceDigest, closure: { version: 1, finalAgentSeq: count,
    receipt: { version: 1, journalAuthority: f.binding.journalAuthority, sourceDigest, manifestDigest: manifest.manifestDigest,
      key: { organizationId: f.key.attempt.organizationId, workspaceId: f.key.attempt.workspaceId,
        attemptId: f.key.attempt.attemptId, generation: 1 } } } } as const;
  const outputs = new OutputCustody(f.db, 'synthetic-installation');
  const events = new EventCustody(f.db, 'synthetic-installation');
  const finalizations = new OutputFinalizations(f.db);
  const command = () => ({ binding: f.binding, sourceDigest: envelope.sourceDigest, manifestDigest: manifest.manifestDigest,
    expectedRunVersion: f.reads.get({ id: f.key.runId, scope: { kind: 'workspace' as const,
      organizationId: f.key.attempt.organizationId, workspaceId: f.key.attempt.workspaceId } }).version });
  const finalize = () => finalizations.execute({ kind: 'outputFinalize', request: command() });
  const adopt = () => outputs.execute({ kind: 'outputAdopt', request: { binding: f.binding, envelope } });
  const release = (patch: Partial<AttemptSnapshot> = {}) => f.observe({ state: 'exited', lastSeq: count === 0 ? 0 : 2,
    admission: { state: 'released', disposition: 'settled' },
    exitEvidence, ...patch });
  const ingest = () => { if (count) events.ingest(request(f.binding, 0, count)); };
  const confirm = () => { if (count) events.confirmAck({ binding: f.binding, throughSeq: count, receipt: ack(f.binding, count) }); };
  const ready = () => { adopt(); release(); ingest(); confirm(); };
  const usage = () => Number(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes);
  return { ...f, outputs, envelope, events, finalizations, command, finalize, adopt, release, ingest, confirm, ready, usage };
}
