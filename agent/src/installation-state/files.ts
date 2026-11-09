import { closeSync, constants, fstatSync, fsyncSync, openSync, realpathSync, lstatSync } from 'node:fs';
import { dirname, isAbsolute, normalize } from 'node:path';
import type { Stats } from 'node:fs';
import { InstallationStateError } from './types.js';

function checkPath(path: string): void {
  if (typeof path !== 'string' || path.length > 4096 || !isAbsolute(path) || normalize(path) !== path
    || realpathSync(dirname(path)) !== dirname(path)) throw new InstallationStateError('invalid_input');
}
export function pinFile(path: string, create: boolean): { close(): void; check(): void } {
  checkPath(path);
  const flags = constants.O_RDWR | constants.O_NOFOLLOW | (create ? constants.O_CREAT | constants.O_EXCL : 0);
  const fd = openSync(path, flags, 0o600); let closed = false; let pinned = true;
  try {
    const original = fstatSync(fd); valid(original);
    if (create) { fsyncSync(fd); syncParent(path); }
    closeSync(fd); pinned = false;
    return { check: () => {
      if (closed) throw new InstallationStateError('closed');
      const current = lstatSync(path); valid(current);
      if (current.dev !== original.dev || current.ino !== original.ino) throw new InstallationStateError('recovery_required');
    }, close: () => { closed = true; } };
  } catch (error) {
    try { if (pinned) closeSync(fd); } catch { throw new InstallationStateError('unavailable'); }
    throw error;
  }
}
function valid(value: Stats): void {
  if (!value.isFile() || value.nlink !== 1 || value.size > 65_536) throw new InstallationStateError('recovery_required');
}
export function syncParent(path: string): void {
  const fd = openSync(dirname(path), constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
  try { fsyncSync(fd); } finally { closeSync(fd); }
}
