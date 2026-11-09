import { expect, it } from 'vitest';
import { validate } from '../src/index.js';
import { readFileSync } from 'node:fs';

const snapshot = JSON.parse(readFileSync(new URL('../fixtures/valid/snapshot.json', import.meta.url), 'utf8')) as Record<string, unknown>;
it.each([
  { state: 'queued' }, { state: 'charged' },
  { state: 'rejected', reason: 'cancelled' }, { state: 'rejected', reason: 'staging_policy' },
  { state: 'released', disposition: 'never_started' }, { state: 'released', disposition: 'settled' },
])('accepts compact independent admission evidence: %j', admission => {
  expect(validate('AttemptAdmission', admission).ok).toBe(true);
  expect(validate('AttemptSnapshot', { ...snapshot, admission }).ok).toBe(true);
});
it('absence supplies no invented fact and does not alter direct-journal snapshots', () => {
  expect(validate('AttemptSnapshot', snapshot).ok).toBe(true);
  expect(Object.hasOwn(snapshot, 'admission')).toBe(false);
});
it.each([
  null, {}, { state: 'unknown' }, { state: 'rejected' },
  { state: 'rejected', reason: 'capacity_unknown' },
  { state: 'released' }, { state: 'released', disposition: 'unknown' },
  { state: 'charged', disposition: 'settled' },
  { state: 'queued', reason: 'queued' },
  { state: 'released', disposition: 'settled', runtimeId: 'private-canary' },
])('refuses ambiguous, transient or private admission shapes: %j', admission => {
  expect(validate('AttemptAdmission', admission).ok).toBe(false);
  expect(validate('AttemptSnapshot', { ...snapshot, admission }).ok).toBe(false);
});
