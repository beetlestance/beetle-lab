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
