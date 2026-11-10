import { transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { acknowledge, snapshotFor } from '../storage/execution-foundation-fixtures.js';
import type { AttemptAdmission, AttemptSnapshot, OutputAbsence } from '@beetle/contracts';
import { OutputAbsences } from '../../src/adapters/outbound/sqlite/output-absence/index.js';
import { EventCustody } from '../../src/adapters/outbound/sqlite/event-custody/index.js';
import { payloadFixture } from '../storage/output-payload-fixtures.js';
import { ack, request } from '../storage/events/fixtures.js';
import { scope } from '../storage/fixture.js';
export function absenceFixture(options: { end?: number; maximum?: number; admission?: AttemptAdmission; reason?: OutputAbsence['reason'] } = {}) {
  const end = options.end ?? 2; const f = payloadFixture(options.maximum ?? 10000, end !== 0);
  const admission = options.admission ?? { state: 'released', disposition: 'settled' };
  if (end === 0) transaction(f.db, () => acknowledge(f.db, f.key, snapshotFor(f.key, { lastSeq: 0, state: 'exited', admission })));
  const proof = { version: 1, ...f.key.attempt, journalAuthority: f.binding.journalAuthority,
    finalAgentSeq: end, admission, reason: options.reason ?? 'artifact_incomplete' };
  const absences = new OutputAbsences(f.db); const events = new EventCustody(f.db, 'synthetic-installation');
  const adopt = () => absences.execute({ kind: 'absenceAdopt', request: { binding: f.binding, closure: proof } });
  const command = () => ({ binding: f.binding, proofDigest: String(f.db.prepare('SELECT proof_digest FROM execution_output_absences').get()?.proof_digest ?? 'a'.repeat(64)),
    expectedRunVersion: f.reads.get({ id: f.key.runId, scope }).version });
  const finalize = () => absences.execute({ kind: 'absenceFinalize', request: command() });
  const release = (patch: Partial<AttemptSnapshot> = {}) => f.observe({ state: 'exited', lastSeq: end, admission, ...patch });
  const ingest = () => { if (end) events.ingest(request(f.binding, 0, end)); };
  const confirm = () => { if (end) events.confirmAck({ binding: f.binding, throughSeq: end, receipt: ack(f.binding, end) }); };
  const ready = () => { adopt(); release(); ingest(); confirm(); };
  const usage = () => Number(f.db.prepare('SELECT charged_bytes FROM installation_storage_usage WHERE id=1').get()?.charged_bytes);
  return { ...f, proof, absences, events, adopt, command, finalize, release, ingest, confirm, ready, usage };
}
