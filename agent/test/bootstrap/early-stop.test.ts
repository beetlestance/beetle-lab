import { expect, it } from 'vitest';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execute = promisify(execFile);
async function run(script: string) {
  const { stdout } = await execute(process.execPath, ['--import', 'tsx', '--input-type=module', '--eval', script], {
    env: { PATH: process.env.PATH, NODE_NO_WARNINGS: '1' },
    timeout: 15000,
    maxBuffer: 8192,
  });
  return stdout;
}

it('keeps a stop that arrives before the runtime bundle loads and hands it to the reconcile signal', async () => {
  const stdout = await run([
    "const early = await import('./agent/src/bootstrap/early-stop.ts');",
    'early.installEarlyStop();',
    "process.kill(process.pid, 'SIGTERM');",
    'await new Promise((resolve) => setTimeout(resolve, 50));',
    "const { reconcileStopSignal } = await import('./agent/src/bootstrap/stop-signal.ts');",
    "console.log(JSON.stringify({ aborted: reconcileStopSignal().aborted, listeners: process.listenerCount('SIGTERM') }));",
  ].join('\n'));
  // The process survived the signal, the stop was handed over and only the owner's handler remains.
  expect(JSON.parse(stdout)).toEqual({ aborted: true, listeners: 1 });
});

it('reports no stop when none arrived and releases its handlers', async () => {
  const stdout = await run([
    "const early = await import('./agent/src/bootstrap/early-stop.ts');",
    'early.installEarlyStop();',
    'const before = process.listenerCount("SIGTERM");',
    'const stopped = early.releaseEarlyStop();',
    "console.log(JSON.stringify({ before, stopped, after: process.listenerCount('SIGTERM'), again: early.releaseEarlyStop() }));",
  ].join('\n'));
  expect(JSON.parse(stdout)).toEqual({ before: 1, stopped: false, after: 0, again: false });
});
