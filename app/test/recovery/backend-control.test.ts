import { mkdtempSync, rmSync, symlinkSync, writeFileSync, chmodSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, expect, it, vi } from 'vitest';
import { initializeBackendRecovery, openBackendRecovery, openBackendServing } from '../../src/bootstrap/recovery-control/index.js';
const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'; const operation = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'; const digest = 'a'.repeat(64);
const roots: string[] = []; afterEach(() => {vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});});
function setup(initialize = true) {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'beetle-cold-gate-'))); chmodSync(root, 0o700); roots.push(root);
  const path = join(root, 'control.sqlite'); if (initialize) initializeBackendRecovery(path, id); return path;
}
it('explicitly initializes, excludes offline/serving owners, and releases only on close', () => {
  const path = setup(); const serve = openBackendServing(path, id);
  expect(() => openBackendRecovery(path, id)).toThrow('owned');
  expect(() => initializeBackendRecovery(path, id)).toThrow('owned'); serve.close(); serve.close();
  const offline = openBackendRecovery(path, id); expect(offline.snapshot().phase).toBe('ready'); offline.close();
});
it('persists incomplete restoration across close/reopen and matches exact completion identity', () => {
  const path = setup(); const restore = openBackendRecovery(path, id); restore.begin(operation, digest); restore.close();
  expect(() => openBackendServing(path, id)).toThrow('recovery_required');
  const resume = openBackendRecovery(path, id); expect(resume.snapshot()).toEqual({phase: 'restoring', purpose: 'installation', operationId: operation, manifestDigest: digest, attestationDigest: null});
  expect(() => resume.complete(id, digest)).toThrow('recovery_required');
  expect(() => resume.complete(operation, 'b'.repeat(64))).toThrow('recovery_required');
  resume.complete(operation, digest); resume.close(); openBackendServing(path, id).close();
});
it('never initializes a missing/corrupt/substituted gate implicitly or adopts another installation', () => {
  const path = setup(false); expect(() => openBackendServing(path, id)).toThrow('recovery_required');
  writeFileSync(path, 'invalid', {mode: 0o600}); expect(() => openBackendServing(path, id)).toThrow('recovery_required');
  const valid = setup(); expect(() => openBackendServing(valid, operation)).toThrow('recovery_required');
  const linked = setup(false); symlinkSync(valid, linked); expect(() => openBackendServing(linked, id)).toThrow('recovery_required');
});
it('holds a real native exclusive database lock and enforces bounded native settings', () => {
  const path = setup(); const serve = openBackendServing(path, id);
  const other = new DatabaseSync(path, {timeout: 1});
  try {expect(() => other.prepare('SELECT phase FROM recovery_control').get()).toThrow();} finally {other.close(); serve.close();}
  const db = new DatabaseSync(path);
  try {expect(db.prepare('PRAGMA page_count').get()?.page_count).toBeLessThanOrEqual(16); expect(db.prepare('PRAGMA user_version').get()?.user_version).toBe(1);}
  finally {db.close();}
});

it('never retries a database close that completed natively and then threw', () => {
  const path = setup(); const lease = openBackendServing(path, id); const original = DatabaseSync.prototype.close;
  const close = vi.spyOn(DatabaseSync.prototype, 'close').mockImplementationOnce(function(this: DatabaseSync) {original.call(this); throw new Error('PRIVATE_NATIVE_ERROR');});
  expect(() => lease.close()).toThrow('Backend recovery cleanup');
  expect(() => lease.close()).toThrow('Backend recovery cleanup'); expect(close).toHaveBeenCalledTimes(1);
  expect(() => openBackendRecovery(path, id)).toThrow('owned'); close.mockRestore();
});

it('keeps historical state irreversible and authentication outside restored metadata', async () => {
  const {initializeHistoricalRecovery, openBackendHistorical} = await import('../../src/bootstrap/recovery-control/index.js');
  const path = setup(false); initializeHistoricalRecovery({path, historyId: id, operationId: operation, manifestDigest: digest});
  expect(() => openBackendServing(path, id)).toThrow('recovery_required');
  const restore = openBackendRecovery(path, id);
  expect(() => restore.complete(operation, digest)).toThrow('recovery_required');
  expect(restore.snapshot()).toMatchObject({phase: 'restoring', purpose: 'history'});
  restore.completeHistorical(operation, digest, 'b'.repeat(64));
  expect(() => restore.complete(operation, digest)).toThrow('recovery_required'); restore.close();
  const history = openBackendHistorical({path, historyId: id, operationId: operation, manifestDigest: digest, attestationDigest: 'b'.repeat(64)});
  expect(await history.sessions.load()).toEqual({version: 0, session: null});
  expect(await history.sessions.save(0, null)).toEqual({version: 1, session: null}); history.close();
  expect(() => openBackendServing(path, id)).toThrow('recovery_required');
});
