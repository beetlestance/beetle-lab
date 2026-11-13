import { afterEach, beforeEach, expect, it } from 'vitest';
import { claimsFixture, makeLegacy } from './dispatch-claim-fixtures.js';
import type { ClaimsFixture } from './dispatch-claim-fixtures.js';
import { cancel, retained } from './run-cancellation-fixtures.js';
import { uuid } from './fixture.js';

let f: ClaimsFixture;
beforeEach(() => { f = claimsFixture(); });
afterEach(() => { f.db.close(); });

const missingProof = ['missing_outbox', 'legacy', 'generation', 'possible', 'attempt_marker',
  'outbox_marker', 'foundation', 'attempt_state', 'second_attempt', 'orphan_output'] as const;
it.each(missingProof)('keeps intent pending without authoritative unsent proof: %s', missing => {
  const key = f.add();
  switch (missing) {
    case 'missing_outbox': f.db.exec('DELETE FROM dispatch_outbox'); break;
    case 'legacy': makeLegacy(f.db, key); break;
    case 'generation':
      f.db.exec('DROP TRIGGER attempts_owned_ack; UPDATE attempts SET generation=1'); break;
    case 'possible':
      f.db.exec(`DROP TRIGGER cleanup_control_delivery; DROP TRIGGER outbox_requires_reservation;
        UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00Z'`); break;
    case 'attempt_marker':
      f.db.exec('DROP TRIGGER attempts_summary_marker; UPDATE attempts SET execution_intent_id=NULL'); break;
    case 'outbox_marker':
      f.db.exec('DROP TRIGGER outbox_summary_marker; UPDATE dispatch_outbox SET execution_intent_id=NULL'); break;
    case 'foundation':
      f.db.exec('DROP TRIGGER attempts_foundation_immutable; UPDATE attempts SET foundation_owned=0'); break;
    case 'attempt_state': f.db.exec("UPDATE attempts SET state='admitted'"); break;
    case 'second_attempt': addSecondAttempt(); break;
    default:
      f.db.exec(`PRAGMA foreign_keys=OFF;
        INSERT INTO attempt_output_allocations(attempt_id,run_id,organization_id,workspace_id,maximum_payload_bytes,
        metadata_bytes,charged_bytes,version) SELECT attempt_id,run_id,organization_id,workspace_id,
        output_bytes,65536,output_bytes+65536,1 FROM execution_intents; PRAGMA foreign_keys=ON;`); break;
  }
  const before = retained(f);
  expect(cancel(f)).toMatchObject({ state: 'queued', cancellationRequested: true, outcome: 'pending',
    validationStatus: 'pending', version: 2 });
  expect(retained(f)).toEqual(before);
  expect(cancel(f)).toMatchObject({ state: 'queued', version: 2 });
  expect(retained(f)).toEqual(before);
});

function addSecondAttempt() {
  f.db.prepare(`INSERT INTO attempts(id,run_id,organization_id,workspace_id,ordinal,intent_digest,
    offer_json,registry_json,generation,state,foundation_owned)
    SELECT ?,run_id,organization_id,workspace_id,2,intent_digest,json_set(offer_json,'$.attemptId',?),
    registry_json,NULL,'offered',1 FROM attempts`).run(uuid(180), uuid(180));
}

it('uses authoritative outbox proof independently of the queued display state', () => {
  f.add(); f.db.exec("UPDATE runs SET state='dispatching'");
  expect(cancel(f)).toMatchObject({ state: 'cancelled', outcome: 'inconclusive', version: 2 });
  expect(f.db.prepare('SELECT * FROM execution_records').all()).toEqual([]);
});

it('does not increment an unchanged cancellation intent at maximum version', () => {
  f.add(); f.db.exec('DELETE FROM dispatch_outbox; UPDATE runs SET cancellation_requested=1,version=9007199254740991');
  expect(cancel(f)).toMatchObject({ cancellationRequested: true, state: 'queued', version: Number.MAX_SAFE_INTEGER });
});
