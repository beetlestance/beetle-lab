import { constants } from 'node:fs';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { expect, it, vi } from 'vitest';
import { archiveFixture } from './archive-fixture.js';
import { RecoveryIO, native } from '../src/io.js';
import { restoreHistory } from '../src/restore.js';
import { openBackendRecovery, openBackendServing } from '../../../app/src/bootstrap/recovery-control/index.js';
const operation = () => ({signal: new AbortController().signal, deadline: performance.now() + 10000});
async function fixture() {
  const f = await archiveFixture(); const request = {archive: f.destination, destination: join(f.root, 'history'),
    operationId: randomUUID(), limits: {...f.bounds, maximumBytes: 2097152}, operation: operation()};
  return {...f, request};
}
it('restores isolated historical files, denies serving and preserves exact completed replay', async () => {
  const f = await fixture(); const result = await restoreHistory(f.request);
  const path = join(f.request.destination, 'history-control.sqlite');
  expect(() => openBackendServing(path, result.historyId)).toThrow('recovery_required');
  const gate = openBackendRecovery(path, result.historyId); expect(gate.snapshot()).toMatchObject({phase: 'historical', purpose: 'history'});
  expect(() => gate.complete(result.operationId, f.result.sha256)).toThrow('recovery_required'); gate.close();
  const payload = join(f.request.destination, 'data', f.result.header.roles.metadata);
  const before = await stat(payload, {bigint: true}); expect(before.mode & 0o777n).toBe(0o400n);
  expect(await readFile(payload)).toEqual(await readFile(join(f.destination, f.result.header.roles.metadata)));
  const replay = await restoreHistory({...f.request, resume: true, operation: operation()}); expect(replay).toEqual(result);
  expect((await stat(payload, {bigint: true})).ctimeNs).toBe(before.ctimeNs);
});
it('never overwrites an existing destination and rejects foreign files on explicit resume', async () => {
  const f = await fixture(); await restoreHistory(f.request);
  await expect(restoreHistory({...f.request, operation: operation()})).rejects.toThrow();
  await writeFile(join(f.request.destination, 'foreign'), 'KEEP', {mode: 0o600});
  await expect(restoreHistory({...f.request, resume: true, operation: operation()})).rejects.toThrow('integrity');
  expect(await readFile(join(f.request.destination, 'foreign'), 'utf8')).toBe('KEEP');
});
it('resumes an interrupted operation without adopting another operation ID or overwriting published bytes', async () => {
  const f = await fixture(); const original = native.open; let denied = false; let copies = 0;
  vi.spyOn(native, 'open').mockImplementation(async (...args) => {
    if (String(args[0]).includes('/history/work/') && typeof args[1] === 'number' && (args[1] & constants.O_EXCL) && ++copies === 2) {denied = true; throw new Error('SYNTHETIC_COPY_FAILURE');}
    return original(...args);
  });
  try {await expect(restoreHistory(f.request)).rejects.toThrow('SYNTHETIC_COPY_FAILURE');} finally {vi.restoreAllMocks();}
  expect(denied).toBe(true);
  await expect(restoreHistory({...f.request, resume: true, operationId: randomUUID(), operation: operation()})).rejects.toThrow('conflict');
  const result = await restoreHistory({...f.request, resume: true, operation: operation()}); expect(result.phase).toBe('historical');
});
it('rejects corrupted local metadata or manifest rather than resealing historical state', async () => {
  const f = await fixture(); await restoreHistory(f.request);
  const manifest = join(f.request.destination, 'manifest.ndjson');
  // Test owner deliberately changes its own immutable fixture; restoration never repairs it.
  const {chmod} = await import('node:fs/promises'); await chmod(manifest, 0o600); await writeFile(manifest, '{}\n');
  await expect(restoreHistory({...f.request, resume: true, operation: operation()})).rejects.toThrow();
});
it('never seals when cancellation arrives during final original-owner drainage', async () => {
  const f = await fixture(); const controller = new AbortController();
  const original = RecoveryIO.prototype.closeAll;
  vi.spyOn(RecoveryIO.prototype, 'closeAll').mockImplementationOnce(async function(this: RecoveryIO) {await original.call(this); controller.abort();});
  try {await expect(restoreHistory({...f.request, operation: {signal: controller.signal, deadline: performance.now() + 10000}})).rejects.toThrow('cancelled');}
  finally {vi.restoreAllMocks();}
  const claim = JSON.parse(await readFile(join(f.request.destination, 'history.json'), 'utf8')) as {historyId: string};
  const gate = openBackendRecovery(join(f.request.destination, 'history-control.sqlite'), claim.historyId);
  expect(gate.snapshot().phase).toBe('restoring'); gate.close();
  expect((await restoreHistory({...f.request, resume: true, operation: operation()})).phase).toBe('historical');
});
it('refuses completion when its claimed work directory is replaced during drainage', async () => {
  const f = await fixture(); const original = RecoveryIO.prototype.closeAll;
  const {rename, mkdir} = await import('node:fs/promises');
  vi.spyOn(RecoveryIO.prototype, 'closeAll').mockImplementationOnce(async function(this: RecoveryIO) {
    await original.call(this); await rename(join(f.request.destination, 'work'), join(f.request.destination, 'old-work'));
    await mkdir(join(f.request.destination, 'work'), {mode: 0o700});
  });
  try {await expect(restoreHistory(f.request)).rejects.toThrow('integrity');} finally {vi.restoreAllMocks();}
  const claim = JSON.parse(await readFile(join(f.request.destination, 'history.json'), 'utf8')) as {historyId: string};
  const gate = openBackendRecovery(join(f.request.destination, 'history-control.sqlite'), claim.historyId);
  expect(gate.snapshot().phase).toBe('restoring'); gate.close();
});
