import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { capturePlan } from './plan.js';
import { runCommand, type Result } from './command.js';

export { capturePlan } from './plan.js';
export async function runChecks(input: unknown, outputDirectory: string, signal?: AbortSignal) {
  const plan = capturePlan(input);
  if (process.platform === 'win32') throw new Error('Check runner requires POSIX process groups');
  if (signal?.aborted) throw new Error('Checks cancelled before startup');
  await mkdir(outputDirectory, {mode: 0o700});
  const startedAt = new Date().toISOString(); const results: Result[] = [];
  for (const check of plan.checks) {
    if (signal?.aborted) break;
    const result = await runCommand({check, cwd: plan.cwd, logPath: join(outputDirectory, `${check.id}.log`), ...(signal ? {signal} : {})});
    results.push(result);
    if (result.status !== 'passed') break;
  }
  const passed = results.length === plan.checks.length && results.every(result => result.status === 'passed');
  const report = {startedAt, finishedAt: new Date().toISOString(), plan, results, passed};
  await writeFile(join(outputDirectory, 'summary.json'), JSON.stringify(report, null, 2), {flag: 'wx', mode: 0o600});
  return report;
}
