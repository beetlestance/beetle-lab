import type { DatabaseSync } from 'node:sqlite';
import type { Candidate, Reservation, Scope } from '../../src/admission/index.js';

import type { Journal } from '../../src/journal/index.js';
import { digest, now } from '../admission/fixtures.js';

export function mutateQueue(db: DatabaseSync, change: (value: Candidate) => void): void {
  const row = db.prepare('SELECT candidate_json FROM admission_queue').get();
  const value = JSON.parse(row?.candidate_json as string) as Candidate;
  change(value);
  db.prepare('UPDATE admission_queue SET candidate_json=?').run(JSON.stringify(value));
}
export function mutateReservation(db: DatabaseSync, change: (value: Reservation) => void): void {
  const row = db.prepare('SELECT reservation_json FROM reservations').get();
  const value = JSON.parse(row?.reservation_json as string) as Reservation;
  change(value);
  db.prepare('UPDATE reservations SET reservation_json=?').run(JSON.stringify(value));
}

export async function releaseOriginal(journal: Journal, key: Scope): Promise<void> {
  const result = await journal.admission({ kind: 'claimCreate', key, specDigest: digest });
  if (!('token' in result)) throw new Error('expected original create claim');
  const binding = { key, createToken: result.token, specDigest: digest, runtimeId: 'private-runtime' };
  await journal.admission({ kind: 'bindRuntime', ...binding });
  await journal.admission({ kind: 'settleLaunch', settlement: { authority: 'supervisor', ...binding,
    epoch: 0, startToken: null, disposition: 'retired', settledAt: now, evidenceId: 'retired-original' } });
  await journal.admission({ kind: 'release', evidence: { authority: 'supervisor', ...binding,
    launch: { epoch: 0, startToken: null, settlementId: 'retired-original' },
    runtime: { state: 'absent', source: 'supervisor', observedAt: now + 1, evidenceId: 'runtime-original' },
    collection: { state: 'failed', observedAt: now + 1, evidenceId: 'collection-original' } } });
}
