import { fork } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { once } from 'node:events';
import { chmod, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach } from 'vitest';
import { openOutputLease } from '../../src/adapters/outbound/files/outputs/lease.js';
import type { OutputLease } from '../../src/adapters/outbound/files/outputs/lease.js';

export function fixture() {
  let root = ''; const children = new Set<ChildProcess>(); const leases = new Set<OutputLease>();
  async function kill(child: ChildProcess): Promise<void> {
    if (child.exitCode !== null || child.signalCode !== null) return;
    const exit = once(child, 'exit'); child.kill('SIGKILL'); await exit;
  }
  beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'beetle-output-lease-'))); await chmod(root, 0o700);
  });
  afterEach(async () => {
    await Promise.all([...children].map(kill)); children.clear();
    await Promise.all([...leases].map(lease => lease.close())); leases.clear();
    await rm(root, { recursive: true, force: true });
  });
  async function open(create = true) {
    const lease = await openOutputLease({ path: join(root, 'namespace.sqlite'), create }); leases.add(lease); return lease;
  }
  function child(mode: 'hold' | 'try' | 'sticky') {
    if (children.size >= 8) throw new Error('Synthetic child limit');
    const child = fork(join(process.cwd(), 'app/test/files/output-lease.child.ts'), [join(root, 'namespace.sqlite'), mode],
      { execArgv: ['--max-old-space-size=128', '--import', 'tsx'], stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    children.add(child);
    const exit = once(child, 'exit');
    const ready = new Promise<unknown>((resolve, reject) => {
      let stderrBytes = 0;
      const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('Synthetic child timeout')); }, 5000);
      child.stderr?.on('data', (bytes: Buffer) => {
        stderrBytes += bytes.length;
        if (stderrBytes > 2048) { child.kill('SIGKILL'); reject(new Error('Synthetic stderr limit')); }
      });
      child.once('error', error => { clearTimeout(timer); reject(error); });
      child.once('exit', () => { clearTimeout(timer); reject(new Error('Synthetic child exited before readiness')); });
      child.once('message', (message: unknown) => { clearTimeout(timer); resolve(message); });
    });
    return { child, ready, exit };
  }
  return { root: () => root, path: () => join(root, 'namespace.sqlite'), open, child, kill };
}
