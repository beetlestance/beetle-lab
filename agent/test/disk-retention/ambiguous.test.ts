import { DatabaseSync } from 'node:sqlite';
import { expect, it } from 'vitest';
import type { AdmissionCommand, LaunchSettlement, ReleaseEvidence, Reservation, Scope } from '../../src/admission/index.js';
import type { Journal } from '../../src/journal/index.js';
import { admissionFixture, configuration, digest, now, observation, reserved, scope } from '../admission/fixtures.js';

const f = admissionFixture();
type Retirement = Extract<AdmissionCommand, { kind: 'release' | 'abortUnstarted' }>;

/** Withhold a real post-commit worker result; the issuing caller never receives it. */
async function loseCommittedReply(journal: Journal, command: Retirement): Promise<Reservation> {
  const attemptId = command.kind === 'release' ? command.evidence.key.attemptId : command.key.attemptId;
  const receive = Reflect.get(journal, 'receive') as (reply: unknown) => void;
  let observed!: (value: Reservation) => void;
  const committed = new Promise<Reservation>(resolve => { observed = resolve; });
  Reflect.set(journal, 'receive', (reply: unknown) => {
    if (reply !== null && typeof reply === 'object'
      && Reflect.get(reply, 'kind') === 'result' && Reflect.get(reply, 'ok') === true) {
      const value: unknown = Reflect.get(reply, 'value');
      if (value !== null && typeof value === 'object'
        && Reflect.get(value, 'attemptId') === attemptId && Reflect.get(value, 'status') === 'released') {
        observed(value as Reservation); return;
      }
    }
    receive.call(journal, reply);
  });
  const issued = journal.admission(command);
  let callerSettled = false;
  void issued.then(() => { callerSettled = true; }, () => { callerSettled = true; });
  const rejected = expect(issued).rejects.toMatchObject({ code: 'unavailable' });
  const value = await Promise.race([committed, issued.then(() => { throw new Error('worker reply was delivered'); })]);
  expect(callerSettled).toBe(false);
  await journal.abort(); await rejected;
  expect(callerSettled).toBe(true);
  return value;
}

/** Inspect native rows while no Journal owns the exclusive SQLite connection. */
function persisted(path: string, attemptId: string) {
  const db = new DatabaseSync(path, { readOnly: true, enableForeignKeyConstraints: true });
  try {
    return {
      authority: db.prepare('SELECT authority FROM journal_authority WHERE id=1').get()?.authority,
      stats: { ...db.prepare('SELECT * FROM disk_retention_stats WHERE id=1').get() },
      holds: db.prepare('SELECT * FROM disk_holds ORDER BY attempt_id').all().map(row => ({ ...row })),
      reservation: { ...db.prepare('SELECT reservation_json,charged FROM reservations WHERE attempt_id=?').get(attemptId) },
      accepted: { ...db.prepare(`SELECT hold_bytes,quota_bytes,spool_bytes,spool_rows,snapshot_bytes,checkpoint_bytes,last_seq
        FROM accepted_attempts WHERE attempt_id=?`).get(attemptId) },
      events: db.prepare('SELECT seq,charged_bytes FROM event_spool WHERE attempt_id=? ORDER BY seq').all(attemptId),
      foreignKeys: db.prepare('PRAGMA foreign_key_check').all(),
    };
  } finally { db.close(); }
}

async function releaseCommand(journal: Journal, key: Scope): Promise<Retirement> {
  const claim = await journal.admission({ kind: 'claimCreate', key, specDigest: digest });
  if (!('token' in claim)) throw new Error('expected create claim');
  const binding = { key, createToken: claim.token, specDigest: digest, runtimeId: 'synthetic-retention-runtime' };
  await journal.admission({ kind: 'bindRuntime', ...binding });
  const settlement: LaunchSettlement = { authority: 'supervisor', ...binding, epoch: 0, startToken: null,
    disposition: 'retired', settledAt: now + 1, evidenceId: 'synthetic-launch-retired' };
  await journal.admission({ kind: 'settleLaunch', settlement });
  const evidence: ReleaseEvidence = { authority: 'supervisor', ...binding,
    launch: { epoch: 0, startToken: null, settlementId: settlement.evidenceId },
    runtime: { state: 'stopped', source: 'supervisor', observedAt: now + 2, evidenceId: 'synthetic-stopped' },
    collection: { state: 'failed', observedAt: now + 2, evidenceId: 'synthetic-collection-failed' } };
  return { kind: 'release', evidence };
}

// RPC unknown-response recovery with owner abort; no power-loss/runtime qualification.
it.each(['release', 'abortUnstarted'] as const)('recovers a committed %s after withholding the actual worker reply without transferring or charging twice', async kind => {
  const path = f.path(); let journal = await f.configured(path);
  const authority = await journal.journalAuthority(); const offer = f.job();
  await f.enqueue(journal, offer); const original = reserved(await f.admit(journal, offer));
  const config = configuration(); config.pool.outputBytes = original.resources.outputBytes;
  config.pool.stagingBytes = original.resources.stagingBytes;
  await journal.admission({ kind: 'configure', configuration: config });
  const command: Retirement = kind === 'release' ? await releaseCommand(journal, scope(offer))
    : { kind: 'abortUnstarted', key: scope(offer) };
  const committed = await loseCommittedReply(journal, command);

  const beforeReplay = persisted(path, offer.attemptId);
  expect(beforeReplay.authority).toBe(authority);
  expect(beforeReplay.foreignKeys).toEqual([]);
  expect(beforeReplay.reservation.charged).toBe(0);
  expect(JSON.parse(String(beforeReplay.reservation.reservation_json))).toEqual(committed);
  expect(beforeReplay.holds).toEqual([{ attempt_id: offer.attemptId, organization_id: offer.organizationId,
    workspace_id: offer.workspaceId, generation: 1, intent_digest: offer.intentDigest,
    output_bytes: original.resources.outputBytes, staging_bytes: original.resources.stagingBytes,
    metadata_bytes: 512, phase: 'retained' }]);
  expect(beforeReplay.stats).toEqual({ id: 1, held_count: 1,
    held_output_bytes: original.resources.outputBytes, held_staging_bytes: original.resources.stagingBytes,
    retained_output_bytes: original.resources.outputBytes, retained_staging_bytes: original.resources.stagingBytes });
  expect(beforeReplay.accepted.hold_bytes).toBe(512);

  journal = await f.open(path);
  expect(await journal.journalAuthority()).toBe(authority);
  expect(await journal.admission({ kind: 'reservation', key: scope(offer) })).toEqual(committed);
  expect(await journal.admission(command)).toEqual(committed);
  expect(await journal.admission(command)).toEqual(committed);
  // Retiring execution does not return its disk promise to the logical pool.
  await journal.admission({ kind: 'observe', observation: observation(now + 3) });
  const next = f.job(2); await f.enqueue(journal, next, now + 3);
  expect(await f.admit(journal, next, now + 3)).toEqual({ kind: 'defer', reason: 'budget_unavailable' });
  await f.close(journal);
  expect(persisted(path, offer.attemptId)).toEqual(beforeReplay);
});
