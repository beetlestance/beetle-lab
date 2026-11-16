import { chmodSync, closeSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it, vi } from 'vitest';
import { initializeBackendRecovery, openBackendRecovery } from '../../src/bootstrap/recovery-control/index.js';
import { native } from '../../src/bootstrap/recovery-control/files.js';
const roots: string[] = []; const id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
afterEach(() => {vi.restoreAllMocks(); for (const root of roots.splice(0)) rmSync(root, {recursive: true, force: true});});
it.each([1, 2])('retains factory ownership after temporary descriptor close %s completes then throws', failingCall => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'beetle-cold-fd-'))); chmodSync(root, 0o700); roots.push(root);
  const path = join(root, 'control.sqlite'); let calls = 0;
  const close = vi.spyOn(native, 'closeSync').mockImplementation(fd => {
    closeSync(fd); if (++calls === failingCall) throw new Error('PRIVATE_DESCRIPTOR_FAILURE');
  });
  expect(() => initializeBackendRecovery(path, id)).toThrow('cleanup');
  const actual = close.mock.calls.length; expect(actual).toBe(failingCall);
  expect(() => openBackendRecovery(path, id)).toThrow('owned');
  expect(() => initializeBackendRecovery(path, id)).toThrow('owned'); expect(close).toHaveBeenCalledTimes(actual);
});

it('does not publish ready state when initial parent synchronization fails', () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'beetle-cold-sync-'))); chmodSync(root, 0o700); roots.push(root);
  const path = join(root, 'control.sqlite'); const original = native.fsyncSync; let calls = 0;
  vi.spyOn(native, 'fsyncSync').mockImplementation(fd => {if (++calls === 2) throw new Error('PRIVATE_SYNC_FAILURE'); original(fd);});
  expect(() => initializeBackendRecovery(path, id)).toThrow('recovery_required');
  expect(() => openBackendRecovery(path, id)).toThrow('recovery_required');
});
