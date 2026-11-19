import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
async function exit(args: string[]) {
  try {
    await execute(process.execPath, ['--import', 'tsx', 'agent/src/bootstrap/main.ts', ...args], {
      env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', BEETLE_AGENT_CONFIG_FILE: '/CANARY/private/agent' },
      timeout: 15000,
      maxBuffer: 8192,
    });
    return { code: 0, stdout: '', stderr: '' };
  } catch (error) {
    return error as { code: number; stdout: string; stderr: string };
  }
}

it('refuses unknown commands and arguments before reading configuration', async () => {
  for (const args of [['serve'], ['--apply'], ['reconcile', '--apply', 'extra'], ['reconcile', '--force']]) {
    const result = await exit(args);
    expect(result.code).toBe(2);
    expect(result.stdout).toBe('');
    expect(result.stderr).toMatch(/^Usage: /);
    expect(result.stderr).not.toContain('CANARY');
  }
}, 60000);

it('routes reconcile to the offline command, which fails closed without configuration', async () => {
  const result = await exit(['reconcile']);
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('');
  expect(result.stderr).toContain('Beetle Lab reconcile failed.');
  expect(result.stderr).not.toContain('CANARY');
}, 20000);

it('reports a stop received before reconcile starts as stopped, not as a startup failure', async () => {
  // The dispatcher's early capture, then a stop before the command module loads.
  const script = [
    "const { reconcileStopSignal } = await import('./agent/src/bootstrap/stop-signal.ts');",
    'const signal = reconcileStopSignal();',
    "process.kill(process.pid, 'SIGTERM');",
    "while (!signal.aborted) await new Promise((resolve) => setTimeout(resolve, 5));",
    "process.argv.splice(1, Infinity, 'main.js', 'reconcile', '--apply');",
    "await import('./agent/src/bootstrap/reconcile.ts');",
  ].join('\n');
  const result = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1', BEETLE_AGENT_CONFIG_FILE: '/CANARY/private/agent' },
    timeout: 15000,
    maxBuffer: 8192,
  }).then(
    () => ({ code: 0, stdout: '', stderr: '' }),
    (error: unknown) => error as { code: number; stdout: string; stderr: string },
  );
  expect(result.code).toBe(1);
  expect(result.stdout).toBe('{"mode":"apply","attempts":0,"refused":0,"stopped":true}\n');
  expect(result.stderr).not.toContain('failed');
  expect(result.stderr).not.toContain('CANARY');
}, 20000);
