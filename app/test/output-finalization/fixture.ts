import type { Artifact, AttemptSnapshot, EngineResult } from '@beetle/contracts';
import { sealEngineResult, encodeCanonicalJson } from '@beetle/contracts';
import { prepareOutputManifest } from '@beetle/contracts/output-source';
import { OutputFinalizations } from '../../src/adapters/outbound/sqlite/output-finalization/index.js';
import { EventCustody } from '../../src/adapters/outbound/sqlite/event-custody/index.js';
import { fixture } from '../storage/output-custody-fixtures.js';
import { hash } from '../storage/output-payload-fixtures.js';
import { ack, request } from '../storage/events/fixtures.js';
export { artifact } from '../storage/output-custody-fixtures.js';
export { uuid, scope } from '../storage/fixture.js';
interface Options { events?: number; artifacts?: Artifact[]; result?: (value: EngineResult) => EngineResult }
export function finalizationFixture(options: Options = {}) {
  const f = fixture(10000, options.artifacts ?? []); const count = options.events ?? 1;
  const mutable = JSON.parse(encodeCanonicalJson(f.envelope.manifest.result, 65536)) as EngineResult;
  const { seal, ...body } = options.result ? options.result(mutable) : mutable;
  const result = sealEngineResult(body, seal.sealedAt, hash); if (!result.ok) throw new Error('Invalid synthetic result');
  const base = f.envelope.manifest;
  const manifest = prepareOutputManifest({ version: 1, binding: base.binding, result: result.value,
    resultFileBytes: base.resultFileBytes, controlBytes: base.controlBytes, verifiedBytes: base.verifiedBytes }, hash);
  const envelope = { ...f.envelope, manifest, closure: { ...f.envelope.closure, finalAgentSeq: count,
    receipt: { ...f.envelope.closure.receipt, manifestDigest: manifest.manifestDigest } } };
  const events = new EventCustody(f.db, 'synthetic-installation');
  const finalizations = new OutputFinalizations(f.db);
  const command = () => ({ binding: f.binding, sourceDigest: envelope.sourceDigest, manifestDigest: manifest.manifestDigest,
    expectedRunVersion: f.reads.get({ id: f.key.runId, scope: { kind: 'workspace' as const,
      organizationId: f.key.attempt.organizationId, workspaceId: f.key.attempt.workspaceId } }).version });
  const finalize = () => finalizations.execute({ kind: 'outputFinalize', request: command() });
  const adopt = () => f.outputs.execute({ kind: 'outputAdopt', request: { binding: f.binding, envelope } });
  const release = (patch: Partial<AttemptSnapshot> = {}) => f.observe({ state: 'exited', lastSeq: 2,
    admission: { state: 'released', disposition: 'settled' },
    exitEvidence: { exitCode: 0, oomKilled: false, observedAt: '2026-01-01T00:01:00Z' }, ...patch });
  const ingest = () => { if (count) events.ingest(request(f.binding, 0, count)); };
  const confirm = () => { if (count) events.confirmAck({ binding: f.binding, throughSeq: count, receipt: ack(f.binding, count) }); };
  const ready = () => { adopt(); release(); ingest(); confirm(); };
  const usage = () => Number(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes);
  return { ...f, envelope, events, finalizations, command, finalize, adopt, release, ingest, confirm, ready, usage };
}
