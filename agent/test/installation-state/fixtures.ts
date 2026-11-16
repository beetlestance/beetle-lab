import { afterEach, beforeEach } from 'vitest';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeInstallationState } from '../../src/installation-state/index.js';

export const first = '11111111-1111-4111-8111-111111111111';
export const other = '22222222-2222-4222-8222-222222222222';
export function fixture() {
  let root: string; const handles: Array<{ close(): void }> = [];
  beforeEach(() => { root = realpathSync(mkdtempSync(join(tmpdir(), 'beetle-gate-'))); });
  afterEach(() => { for (const h of handles) h.close(); handles.length = 0; rmSync(root, { recursive: true }); });
  const own = <T extends { close(): void }>(value: T): T => { handles.push(value); return value; };
  const path = () => join(root, 'control.sqlite');
  return { path, own, root: () => root, ready: () => {
    const value = own(initializeInstallationState(path())); value.complete(first); value.close();
  } };
}
