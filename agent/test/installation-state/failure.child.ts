import assert from 'node:assert/strict';
import { closeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { initializeInstallationState, openServingState } from '../../src/installation-state/index.js';
import { native } from '../../src/installation-state/files.js';
const [mode, path] = process.argv.slice(2); assert(path);
const authority = '11111111-1111-4111-8111-111111111111'; let calls = 0;
if (mode === 'database') {
  const init = initializeInstallationState(path); init.complete(authority); init.close(); const serve = openServingState(path);
  const original = DatabaseSync.prototype.close;
  DatabaseSync.prototype.close = function(this: DatabaseSync) {calls++; original.call(this); throw new Error('PRIVATE_NATIVE_ERROR');};
  assert.throws(() => serve.close(), /unavailable/); assert.throws(() => serve.close(), /unavailable/);
  assert.equal(calls, 1); assert.throws(() => serve.assertJournalAuthority(authority), /unavailable/);
} else {
  assert(mode === 'file' || mode === 'directory'); const failing = mode === 'file' ? 1 : 2;
  native.closeSync = fd => {closeSync(fd); if (++calls === failing) throw new Error('PRIVATE_NATIVE_ERROR');};
  assert.throws(() => initializeInstallationState(path), /unavailable/); assert.equal(calls, failing);
}
const before = calls; assert.throws(() => openServingState(path), /owned/);
assert.throws(() => initializeInstallationState(path + '.other'), /owned/); assert.equal(calls, before);
process.stdout.write('retained-originals\n');
