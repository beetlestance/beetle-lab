import { expect, it } from 'vitest';
import { DatabaseSync } from 'node:sqlite';
import { chmodSync, linkSync, lstatSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { initializeInstallationState, resumeInstallationInitialization, openServingState, openRestoringState } from '../../src/installation-state/index.js';
import { fixture, first, other } from './fixtures.js';

const f = fixture();
it('requires explicit initialization and persists the same authority across normal reopen', () => {
  expect(() => openServingState(f.path())).toThrow('recovery_required');
  expect(() => lstatSync(f.path())).toThrow();
  const initial = f.own(initializeInstallationState(f.path()));
  expect(initial.operationId).toMatch(/^[a-f0-9-]{36}$/u);
  initial.complete(first); initial.close();
  expect(lstatSync(f.path()).mode & 0o777).toBe(0o600);
  for (let n = 0; n < 2; n++) {
    const serving = f.own(openServingState(f.path()));
    expect(serving.journalAuthority).toBe(first); serving.assertJournalAuthority(first);
    expect(() => serving.assertJournalAuthority(other)).toThrow('recovery_required');
    expect(serving).not.toHaveProperty('complete'); expect(serving).not.toHaveProperty('begin'); serving.close();
  }
});
it('keeps interrupted initialization fenced and only the explicit resume can complete it', () => {
  const initial = f.own(initializeInstallationState(f.path())); const operation = initial.operationId; initial.close();
  expect(() => openServingState(f.path())).toThrow('recovery_required');
  expect(() => initializeInstallationState(f.path())).toThrow('recovery_required');
  const resumed = f.own(resumeInstallationInitialization(f.path())); expect(resumed.operationId).toBe(operation);
  expect(() => resumed.complete('AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA')).toThrow('invalid_input');
  resumed.complete(first); expect(() => resumed.complete(other)).toThrow('recovery_required'); resumed.close();
  expect(() => resumeInstallationInitialization(f.path())).toThrow('recovery_required');
  f.own(openServingState(f.path())).assertJournalAuthority(first);
});
it('owns one local installation and rejects other facades without releasing the owner', () => {
  f.ready(); const serving = f.own(openServingState(f.path()));
  for (let n = 0; n < 2; n++) {
    expect(() => openRestoringState(f.path())).toThrow('owned');
    expect(() => openServingState(f.path())).toThrow('owned');
    serving.assertJournalAuthority(first);
  }
  serving.close(); const restore = f.own(openRestoringState(f.path())); restore.close();
});
it('persists planned restore authority and never resumes serving until exact completion', () => {
  f.ready(); const restore = f.own(openRestoringState(f.path())); const plan = restore.begin(other);
  expect(plan.phase).toBe('restoring'); expect(plan.authority).toBe(first); expect(plan.pending).not.toBe(first);
  expect(Object.isFrozen(plan)).toBe(true); restore.close();
  expect(() => openServingState(f.path())).toThrow('recovery_required');
  const resumed = f.own(openRestoringState(f.path())); expect(resumed.snapshot()).toEqual(plan);
  expect(() => resumed.begin(first)).toThrow('recovery_required');
  expect(() => resumed.complete(first, plan.pending)).toThrow('recovery_required');
  expect(() => resumed.complete(other, first)).toThrow('recovery_required');
  expect(resumed.snapshot()).toEqual(plan); resumed.complete(other, plan.pending); resumed.close();
  const serving = f.own(openServingState(f.path())); serving.assertJournalAuthority(plan.pending);
  expect(() => serving.assertJournalAuthority(first)).toThrow('recovery_required');
});
it.each(['missing', 'bad', 'long-initializing', 'future'] as const)('refuses %s state without repairing or generating authority', shape => {
  const initial = f.own(initializeInstallationState(f.path())); initial.close();
  const db = new DatabaseSync(f.path());
  try {
    if (shape === 'missing') db.exec('DROP TRIGGER state_no_delete; DELETE FROM installation_state;');
    if (shape === 'bad') db.exec("PRAGMA ignore_check_constraints=ON; UPDATE installation_state SET phase='bad';");
    if (shape === 'long-initializing') db.prepare('PRAGMA ignore_check_constraints=ON;').run();
    if (shape === 'long-initializing') db.prepare('UPDATE installation_state SET authority=?').run('x'.repeat(10_000));
    if (shape === 'future') db.exec('PRAGMA user_version=2;');
  } finally { db.close(); }
  expect(() => openServingState(f.path())).toThrow('recovery_required');
  expect(() => resumeInstallationInitialization(f.path())).toThrow('recovery_required');
});
it('refuses symlink/hardlink/oversized files and preserves them', () => {
  const actual = join(f.root(), 'actual'); writeFileSync(actual, 'unchanged'); symlinkSync(actual, f.path());
  expect(() => openServingState(f.path())).toThrow('recovery_required');
  expect(lstatSync(f.path()).isSymbolicLink()).toBe(true);
  const hard = join(f.root(), 'hard'); linkSync(actual, hard);
  expect(() => openServingState(hard)).toThrow('recovery_required');
  const huge = join(f.root(), 'huge'); writeFileSync(huge, Buffer.alloc(65_537)); chmodSync(huge, 0o600);
  expect(() => openServingState(huge)).toThrow('recovery_required'); expect(lstatSync(huge).size).toBe(65_537);
});
it('bounds control pages and enforces state guards with durable settings', () => {
  f.ready(); const db = new DatabaseSync(f.path());
  try {
    expect(() => db.exec('DELETE FROM installation_state')).toThrow();
    expect(() => db.exec(`INSERT OR REPLACE INTO installation_state(id,phase,authority) VALUES(1,'ready','${other}')`)).toThrow();
    expect(db.prepare('PRAGMA page_size').get()?.page_size).toBe(4096);
    expect(Number(db.prepare('PRAGMA page_count').get()?.page_count)).toBeLessThanOrEqual(16);
    expect(db.prepare('SELECT authority FROM installation_state').get()?.authority).toBe(first);
  } finally { db.close(); }
});

it.each(['id', 'duplicate', 'oversized-id'] as const)('rejects corrupt singleton %s with bounded projection', shape => {
  f.ready(); const db = new DatabaseSync(f.path());
  try {
    db.exec('DROP TABLE installation_state; CREATE TABLE installation_state(id,phase,operation_id,authority,pending);');
    db.prepare("INSERT INTO installation_state VALUES(?,'ready',NULL,?,NULL)").run(shape === 'id' ? 2 : 1, first);
    if (shape === 'duplicate') db.prepare("INSERT INTO installation_state VALUES(2,'ready',NULL,?,NULL)").run(other);
    if (shape === 'oversized-id') db.prepare('UPDATE installation_state SET id=?').run('x'.repeat(65_536));
  } finally { db.close(); }
  expect(() => openServingState(f.path())).toThrow('recovery_required');
});
