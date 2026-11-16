import { afterEach, beforeEach, expect, it } from 'vitest';
import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeInstallationState, openServingState, openRestoringState } from '../../src/installation-state/index.js';

const first = '11111111-1111-4111-8111-111111111111';
const operation = '22222222-2222-4222-8222-222222222222';
const children = new Set<ChildProcess>();
let root: string; let path: string;
beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'beetle-gate-process-'))); path = join(root, 'control.sqlite');
  const init = initializeInstallationState(path); init.complete(first); init.close();
});
async function kill(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
}
afterEach(async () => {
  await Promise.all([...children].map(kill)); children.clear(); rmSync(root, { recursive: true });
});
function start(mode: 'serve' | 'restore'): Promise<{ child: ChildProcess; authority: string }> {
  if (children.size !== 0) throw new Error('Synthetic child bound');
  const child = fork(join(process.cwd(), 'agent/test/installation-state/process.child.ts'), [mode, path, operation],
    { execArgv: ['--max-old-space-size=128', '--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
  children.add(child);
  return new Promise((resolve, reject) => {
    let stderr = ''; const timer = setTimeout(() => reject(new Error('Synthetic child readiness timeout')), 5000);
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length + chunk.length > 1024) { child.kill('SIGKILL'); reject(new Error('Synthetic stderr limit')); return; }
      stderr += chunk.toString();
    });
    child.once('error', error => { clearTimeout(timer); reject(error); });
    child.once('exit', () => { clearTimeout(timer); reject(new Error(`Synthetic child exited: ${stderr}`)); });
    child.once('message', (message: unknown) => {
      clearTimeout(timer);
      if (message === null || typeof message !== 'object' || !('kind' in message) || message.kind !== 'ready'
        || !('authority' in message) || typeof message.authority !== 'string' || !/^[a-f0-9-]{36}$/u.test(message.authority)) {
        reject(new Error('Unexpected synthetic readiness')); return;
      }
      resolve({ child, authority: message.authority });
    });
  });
}
it('holds the actual cross-process lease and permits intact serving after process death', async () => {
  const active = await start('serve'); expect(active.authority).toBe(first);
  for (let i = 0; i < 2; i++) {
    expect(() => openServingState(path)).toThrow('owned');
    expect(() => openRestoringState(path)).toThrow('owned');
  }
  await kill(active.child);
  const resumed = openServingState(path);
  try { resumed.assertJournalAuthority(first); } finally { resumed.close(); }
});
it('retains durable restoring state after the owner is killed and requires exact recovery', async () => {
  const active = await start('restore'); expect(active.authority).not.toBe(first); await kill(active.child);
  expect(() => openServingState(path)).toThrow('recovery_required');
  const restore = openRestoringState(path);
  try {
    expect(restore.snapshot()).toEqual({ phase: 'restoring', operationId: operation, authority: first, pending: active.authority });
    restore.complete(operation, active.authority);
  } finally { restore.close(); }
  const serving = openServingState(path);
  try { serving.assertJournalAuthority(active.authority); } finally { serving.close(); }
});
