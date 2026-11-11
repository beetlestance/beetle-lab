import { afterEach, expect, it } from 'vitest';
import * as fs from 'node:fs/promises';
import { createServer } from 'node:net';
import type { Server } from 'node:net';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { join, resolve } from 'node:path';
const execute = promisify(execFile);
const launcher = resolve('deploy/local/beetle');
interface Fixture { root: string; directory: string; socket: string; log: string; server: Server; env: NodeJS.ProcessEnv }
const fixtures: Fixture[] = [];
afterEach(async () => {
  for (const f of fixtures.splice(0)) {
    await new Promise<void>((accept, reject) => f.server.close(error => error ? reject(error) : accept()));
    await fs.rm(f.root, { recursive: true, force: true });
  }
});
async function fixture(): Promise<Fixture> {
  const root = await fs.realpath(await fs.mkdtemp('/tmp/beetle-w330-shell-'));
  const directory = join(root, 'private with spaces'); const socket = join(root, 'docker.sock'); const log = join(root, 'calls.jsonl');
  await fs.mkdir(directory, { mode: 0o700 }); await fs.mkdir(join(directory, 'setup'), { mode: 0o700 });
  const revision = (await execute('git', ['rev-parse', '--short=12', 'HEAD'])).stdout.trim();
  await fs.writeFile(join(directory, 'setup', 'compose.env'), `BEETLE_SOURCE_REVISION='${revision}'\nBEETLE_PORT='8890'\nBEETLE_DOCKER_SOCKET='${socket}'\nBEETLE_DOCKER_GID='0'\n`, { mode: 0o600 });
  const server = createServer();
  try { await new Promise<void>((accept, reject) => { server.once('error', reject); server.listen(socket, accept); }); }
  catch (cause) { await fs.rm(root, { recursive: true, force: true }); throw cause; }
  const bin = join(root, 'bin'); await fs.mkdir(bin);
  const docker = `#!${process.execPath}
const fs=require('node:fs'); const a=process.argv.slice(2);fs.appendFileSync(process.env.FAKE_LOG,JSON.stringify({a,host:process.env.DOCKER_HOST,context:process.env.DOCKER_CONTEXT,override:process.env.BEETLE_PORT})+'\\n');
if(a[0]==='context')console.log('unix://'+process.env.FAKE_SOCKET);
else if(a[0]==='image')process.exit(process.env.FAKE_MISSING==='yes'?1:0);
else if(a[0]==='build')process.exit(process.env.FAKE_BUILD_FAIL==='yes'?1:0);
else if(a.includes('/beetle/install/local.js')){if(process.env.FAKE_CONFIG_FAIL==='yes')process.exit(1);if(process.env.FAKE_STATE==='local_created_fresh'){const d=a[a.indexOf('--directory')+1];fs.mkdirSync(d+'/setup',{recursive:true});fs.writeFileSync(d+'/setup/compose.env','synthetic');}console.log(process.env.FAKE_STATE||'local_unchanged_ready');}
else if(a[0]==='run')console.log('0');
else if(a[0]==='compose'&&a.includes('ps')&&a.includes('-q'))console.log('synthetic-backend');
else if(a[0]==='inspect'){if(process.env.FAKE_RUNNING!=='no')console.log('2026-01-01T00:00:00Z');}
else if(a[0]==='logs'){console.log('private unrelated canary'); if(process.env.FAKE_TOKEN_MISSING!=='yes')console.log('Beetle Lab local startup token: '+ 'T'.repeat(43));}
else if(a[0]==='compose'&&a.includes('installer')&&process.env.FAKE_INSTALL_FAIL==='yes')process.exit(1);
`;
  await fs.writeFile(join(bin, 'docker'), docker, { mode: 0o700 });
  const f = { root, directory, socket, log, server, env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_LOG: log,
    FAKE_SOCKET: socket, DOCKER_HOST: `unix://${socket}`, DOCKER_CONTEXT: 'synthetic-context', BEETLE_PORT: '9999' } };
  fixtures.push(f); return f;
}
async function run(f: Fixture, command: string, extra: string[] = []) {
  return execute('/bin/sh', [launcher, command, '--directory', f.directory, ...extra], { env: f.env, timeout: 8000, maxBuffer: 262144 });
}
async function calls(f: Fixture): Promise<{ a: string[]; host?: string; context?: string; override?: string }[]> {
  return (await fs.readFile(f.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
}
it('ready up verifies configuration, preserves spaces/pins and skips all builds/offline provisioning', async () => {
  const f = await fixture(); const result = await run(f, 'up'); const recorded = await calls(f);
  expect(result.stdout).toContain('http://127.0.0.1:8890'); expect(result.stdout).not.toContain('T'.repeat(43));
  expect(recorded.some(call => call.a[0] === 'build')).toBe(false);
  expect(recorded.some(call => call.a[0] === 'compose' && call.a.includes('installer'))).toBe(false);
  const config = recorded.find(call => call.a.includes('/beetle/install/local.js'))!;
  expect(config.a).toContain(`type=bind,source=${f.directory},target=${f.directory}`);
  expect(config.a).toContain(f.directory); expect(config.a).not.toContain('/var/run/docker.sock');
  const up = recorded.find(call => call.a[0] === 'compose')!;
  expect(up.a).toContain(join(f.directory, 'setup', 'compose.env'));
  expect(up.a.slice(-7)).toEqual(['up', '-d', '--no-build', '--pull', 'never', 'frontend', 'backend', 'agent'].slice(-7));
  expect(up.host).toBe(`unix://${f.socket}`); expect(up.context).toBeUndefined(); expect(up.override).toBeUndefined();
});
it('fresh up initializes once before starting services and fails visibly on installer error', async () => {
  const f = await fixture(); f.env.FAKE_STATE = 'local_unchanged_fresh';
  await run(f, 'up'); let recorded = await calls(f);
  const installer = recorded.findIndex(call => call.a[0] === 'compose' && call.a.includes('installer'));
  const up = recorded.findIndex(call => call.a[0] === 'compose' && call.a.includes('up'));
  expect(installer).toBeGreaterThan(-1); expect(up).toBeGreaterThan(installer);
  f.env.FAKE_INSTALL_FAIL = 'yes'; await fs.writeFile(f.log, '');
  await expect(run(f, 'up')).rejects.toMatchObject({ code: 1 }); recorded = await calls(f);
  expect(recorded.some(call => call.a.includes('up'))).toBe(false);
});
it.each(['stop', 'status'] as const)('%s uses only the same validated deployment and never builds/provisions', async command => {
  const f = await fixture(); await run(f, command); const recorded = await calls(f);
  expect(recorded.some(call => ['image', 'build', 'run'].includes(call.a[0]!))).toBe(false);
  expect(recorded.filter(call => call.a[0] === 'compose')).toHaveLength(1);
  expect(recorded.at(-1)!.a).toContain(command === 'stop' ? 'stop' : 'ps');
  expect(recorded.at(-1)!.a).not.toContain('installer');
});
it('token prints only the current-startup token from bounded logs', async () => {
  const f = await fixture(); const result = await run(f, 'token'); const recorded = await calls(f);
  expect(result.stdout).toBe('T'.repeat(43) + '\n'); expect(result.stdout).not.toContain('canary');
  expect(recorded.at(-1)!.a).toEqual(['logs', '--since', '2026-01-01T00:00:00Z', '--tail', '200', 'synthetic-backend']);
});
it('refuses rebuilding missing or explicitly requested pins from a changed checkout', async () => {
  const f = await fixture(); f.env.FAKE_MISSING = 'yes';
  const envFile = join(f.directory, 'setup', 'compose.env');
  await fs.writeFile(envFile, (await fs.readFile(envFile, 'utf8')).replace(/^BEETLE_SOURCE_REVISION=.*$/mu, "BEETLE_SOURCE_REVISION='deadbeef0000'"));
  await expect(run(f, 'up')).rejects.toMatchObject({ stderr: expect.stringContaining('original source checkout') });
  expect((await calls(f)).some(call => call.a[0] === 'build')).toBe(false);
  f.env.FAKE_MISSING = 'no';
  await expect(run(f, 'up', ['--build'])).rejects.toMatchObject({ stderr: expect.stringContaining('original source checkout') });
});
it('fresh source builds serially with explicit optional builder and probes container socket group', async () => {
  const f = await fixture(); await fs.rm(join(f.directory, 'setup'), { recursive: true });
  f.env.FAKE_MISSING = 'yes'; f.env.FAKE_STATE = 'local_created_fresh'; f.env.BEETLE_BUILDER = 'synthetic-builder';
  await run(f, 'up', ['--socket', f.socket]); const recorded = await calls(f);
  const builds = recorded.filter(call => call.a[0] === 'build'); expect(builds).toHaveLength(5);
  expect(builds.map(call => call.a[call.a.indexOf('--file') + 1])).toEqual(['tools/install/Dockerfile', 'web/Dockerfile', 'app/Dockerfile', 'agent/Dockerfile', 'engines/k6/Dockerfile'].map(file => resolve(file)));
  for (const build of builds) { expect(build.a).toContain('--load'); expect(build.a).toContain('--builder'); expect(build.a).toContain('synthetic-builder'); }
  const probe = recorded.find(call => call.a[0] === 'run' && call.a.includes('65534:65534'))!;
  expect(probe.a).toContain('--network'); expect(probe.a).toContain('none'); expect(probe.a).toContain('--memory');
  const setup = recorded.find(call => call.a.includes('/beetle/install/local.js'))!;
  expect(setup.a[setup.a.indexOf('--docker-gid') + 1]).toBe('0');
});
it('build/config failures stop before initialization and preserve private directory', async () => {
  const f = await fixture(); f.env.FAKE_CONFIG_FAIL = 'yes';
  await expect(run(f, 'up')).rejects.toMatchObject({ code: 1 });
  expect((await calls(f)).some(call => call.a[0] === 'compose')).toBe(false);
  expect((await fs.stat(f.directory)).isDirectory()).toBe(true);
});
it('rejects remote daemons and unsupported/duplicate options before containers start', async () => {
  const f = await fixture(); f.env.DOCKER_HOST = 'tcp://synthetic.invalid:2375';
  await expect(run(f, 'up')).rejects.toMatchObject({ stderr: expect.stringContaining('only local Unix') });
  await expect(run(f, 'status', ['--build'])).rejects.toMatchObject({ code: 1 });
  await expect(run(f, 'up', ['--directory', f.directory])).rejects.toMatchObject({ code: 1 });
  expect((await fs.readdir(f.root)).includes('calls.jsonl')).toBe(false);
});

it('rejects a non-socket host path without starting a container', async () => {
  const f = await fixture(); const file = join(f.root, 'ordinary-file'); await fs.writeFile(file, 'keep');
  await expect(run(f, 'up', ['--socket', file])).rejects.toMatchObject({ stderr: expect.stringContaining('Docker socket missing') });
  expect((await fs.readdir(f.root)).includes('calls.jsonl')).toBe(false);
});
it('token fails without exposing unrelated logs if backend is stopped or token unavailable', async () => {
  const f = await fixture(); f.env.FAKE_RUNNING = 'no';
  await expect(run(f, 'token')).rejects.toMatchObject({ stdout: '', stderr: expect.stringContaining('backend is not running') });
  f.env.FAKE_RUNNING = 'yes'; f.env.FAKE_TOKEN_MISSING = 'yes';
  await expect(run(f, 'token')).rejects.toMatchObject({ stdout: '', stderr: expect.stringContaining('startup token unavailable') });
  expect((await calls(f)).some(call => call.a[0] === 'run')).toBe(false);
});
it('a failed source build preserves the root and never configures or provisions', async () => {
  const f = await fixture(); await fs.rm(join(f.directory, 'setup'), { recursive: true });
  f.env.FAKE_MISSING = 'yes'; f.env.FAKE_BUILD_FAIL = 'yes'; delete f.env.BEETLE_BUILDER;
  await expect(run(f, 'up', ['--socket', f.socket])).rejects.toMatchObject({ code: 1 });
  const recorded = await calls(f); expect(recorded.filter(call => call.a[0] === 'build')).toHaveLength(1);
  expect(recorded.some(call => call.a[0] === 'run' || call.a[0] === 'compose')).toBe(false);
  expect(recorded.find(call => call.a[0] === 'build')!.a).not.toContain('--builder');
  expect((await fs.stat(f.directory)).isDirectory()).toBe(true);
});
