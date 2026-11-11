import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { capturePlan, runChecks } from './index.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(path => rm(path, {recursive: true, force: true}))); });
async function fixture() {
  const cwd = await mkdtemp(join(tmpdir(), 'beetle-check-runner-')); directories.push(cwd);
  return {cwd, output: join(cwd, 'evidence')};
}
function command(id: string, source: string, timeoutMs = 2000) {
  return {id, argv: [process.execPath, '-e', source], timeoutMs};
}
it('validates all checks before executing and rejects duplicate commands or ids', async () => {
  const {cwd, output} = await fixture(); const first = command('first', 'process.exit(0)');
  await expect(runChecks({cwd, checks: [first, {...first, id: 'second'}]}, output)).rejects.toThrow('Duplicate');
  await expect(stat(output)).rejects.toMatchObject({code: 'ENOENT'});
  expect(() => capturePlan({cwd, checks: [first, command('first', 'process.exit(1)')]})).toThrow('Duplicate');
  expect(() => capturePlan({cwd, checks: [{...first, timeoutMs: 900001}]})).toThrow('timeout');
});
it('runs argument vectors literally once and writes a truthful summary', async () => {
  const {cwd, output} = await fixture();
  const report = await runChecks({cwd, checks: [{id: 'literal', argv: [process.execPath, '-e', 'console.log(process.argv[1])', '$(echo unsafe)'], timeoutMs: 2000}]}, output);
  expect(report.passed).toBe(true); expect(report.results[0]).toMatchObject({status: 'passed', exitCode: 0});
  expect(await readFile(join(output, 'literal.log'), 'utf8')).toBe('$(echo unsafe)\n');
  expect(JSON.parse(await readFile(join(output, 'summary.json'), 'utf8'))).toEqual(report);
  await expect(runChecks({cwd, checks: [command('repeat', 'process.exit(0)')]}, output)).rejects.toMatchObject({code: 'EEXIST'});
});
it('stops on failure without running the next command', async () => {
  const {cwd, output} = await fixture();
  const report = await runChecks({cwd, checks: [command('failure', 'console.error("broken"); process.exit(7)'), command('later', 'process.exit(0)')]}, output);
  expect(report.passed).toBe(false); expect(report.results).toHaveLength(1);
  expect(report.results[0]).toMatchObject({status: 'failed', exitCode: 7});
  expect(await readFile(join(output, 'failure.log'), 'utf8')).toContain('broken');
  await expect(stat(join(output, 'later.log'))).rejects.toMatchObject({code: 'ENOENT'});
});
it('bounds output and reports overflow instead of success', async () => {
  const {cwd, output} = await fixture();
  const report = await runChecks({cwd, checks: [command('flood', 'process.stdout.write("x".repeat(2000000))')]}, output);
  expect(report.passed).toBe(false); expect(report.results[0]).toMatchObject({status: 'output_limit', logBytes: 1048576});
  expect((await stat(join(output, 'flood.log'))).size).toBe(1048576);
});
it('terminates a stalled process group within its timeout and reports cancellation separately', async () => {
  const {cwd, output} = await fixture();
  const report = await runChecks({cwd, checks: [command('stall', 'setInterval(() => {}, 1000)', 50)]}, output);
  expect(report.results[0]).toMatchObject({status: 'timeout'}); expect(report.passed).toBe(false);
  const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), 30);
  try {
    const cancelled = await runChecks({cwd, checks: [command('cancel', 'setInterval(() => {}, 1000)')]}, join(cwd, 'cancelled'), controller.signal);
    expect(cancelled.results[0]).toMatchObject({status: 'cancelled'}); expect(cancelled.passed).toBe(false);
  } finally { clearTimeout(timer); }
});
it('records spawn errors and refuses already cancelled plans without creating output', async () => {
  const {cwd, output} = await fixture();
  const report = await runChecks({cwd, checks: [{id: 'missing', argv: [join(cwd, 'missing')], timeoutMs: 1000}]}, output);
  expect(report.results[0]).toMatchObject({status: 'spawn_error'}); expect(report.passed).toBe(false);
  await expect(runChecks({cwd, checks: [command('cancelled', 'process.exit(0)')]}, join(cwd, 'absent'), AbortSignal.abort())).rejects.toThrow('cancelled');
  await expect(stat(join(cwd, 'absent'))).rejects.toMatchObject({code: 'ENOENT'});
});
