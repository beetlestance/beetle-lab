import assert from 'node:assert/strict';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join, resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {Docker} from '../docker.js';
import {readDeliveryJson, deliveryDigest} from '../../delivery/files.js';
import {capturePublishedPlan} from '../../delivery/registry/value.js';
import {verifyLoadedImage} from '../../delivery/registry/native-value.js';
import {programs} from './programs.js';
import type {Case} from './programs.js';
import {record, counter, programReport, cpuEvidence, pidEvidence, qualificationArchitecture} from './values.js';
const cases = ['cpu', 'memory', 'pids', 'descendants'] as const;
const limits = ['--cpus', '1', '--memory', '512m', '--memory-swap', '512m', '--pids-limit', '128', '--init=false',
  '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true', '--network', 'none',
  '--tmpfs', '/tmp:rw,nosuid,nodev,size=16777216', '--log-driver', 'json-file', '--log-opt', 'max-size=64k', '--log-opt', 'max-file=1'];
function inspection(docker: Docker, id: string, owner: string, allowed: readonly string[]) {
  const rows = docker.json<unknown[]>(['inspect', id]); assert.equal(rows.length, 1); const row = record(rows[0]);
  assert.equal(row.Id, id); assert(allowed.includes(String(row.Image)));
  const config = record(row.Config); assert.equal(record(config.Labels)['dev.beetle.qualification'], owner);
  assert.equal(config.User, '1000:1000');
  const host = record(row.HostConfig);
  assert.equal(host.NanoCpus, 1000000000); assert.equal(host.Memory, 536870912); assert.equal(host.MemorySwap, 536870912);
  assert.equal(host.PidsLimit, 128); assert.equal(host.ReadonlyRootfs, true); assert.equal(host.NetworkMode, 'none'); assert.equal(host.Init, false);
  assert.deepEqual(host.CapDrop, ['ALL']); assert(Array.isArray(host.SecurityOpt) && host.SecurityOpt.some(value => typeof value === 'string' && /^no-new-privileges(?::true|=true)?$/.test(value)));
  return {state: record(row.State), controls: {cpuMillis: 1000, memoryBytes: 536870912, swapBytes: 0, pids: 128, readonly: true, network: 'none', init: false}};
}
interface Fixture {docker: Docker; image: string; owner: string; allowed: readonly string[]; architecture: string; output: string}
function within(deadline: number): void {assert(performance.now() < deadline, 'Resource result deadline');}
const pause = () => new Promise<void>(resolve => setTimeout(resolve, 200));
async function exited(docker: Docker, id: string, deadline: number) {
  while (performance.now() < deadline) {
    const rows = docker.json<unknown[]>(['inspect', id]); assert.equal(rows.length, 1); const state = record(record(rows[0]).State);
    if (state.Running === false) return state;
    await pause();
  }
  throw Error('Resource case deadline');
}
async function descendantStop(docker: Docker, id: string, architecture: string, deadline: number) {
  while (performance.now() < deadline) {
    const logs = docker.logs(id);
    if (logs.includes('"kind":"descendants-ready"')) {
      const row = programReport(logs, 'descendants-ready', architecture);
      assert(counter(row.processes) >= counter(row.baselineProcesses) + 2); assert(counter(row.current) <= 128); within(deadline);
      const started = performance.now(); docker.run(['stop', '--time', '2', id]);
      return {stopElapsedMs: Math.ceil(performance.now() - started), readyPids: row.current, readyProcesses: row.processes};
    }
    await pause();
  }
  throw Error('Descendant readiness deadline');
}
async function runCase(fixture: Fixture, kind: Case) {
  const {docker, image, owner, allowed, architecture, output} = fixture;
  const deadline = performance.now() + 60000; const name = `${owner}-${kind}`;
  const id = docker.run(['create', '--pull', 'never', '--name', name, '--label', `dev.beetle.qualification=${owner}`,
    ...limits, '--entrypoint', 'node', image, '--input-type=commonjs', '-e', programs[kind]]);
  assert.match(id, /^[a-f0-9]{64}$/); within(deadline); const configured = inspection(docker, id, owner, allowed);
  within(deadline);
  docker.run(['start', id]);
  const stopped = kind === 'descendants' ? await descendantStop(docker, id, architecture, deadline) : null;
  const state = await exited(docker, id, deadline); within(deadline); assert.equal(state.Running, false); assert.equal(state.Pid, 0);
  const logs = docker.logs(id); assert(Buffer.byteLength(logs) <= 65536);
  await writeFile(join(output, `${kind}-private.log`), logs, {flag: 'wx', mode: 0o600});
  const reportKind = {cpu: 'cpu', memory: 'memory-start', pids: 'pids', descendants: 'descendants-ready'}[kind];
  const row = programReport(logs, reportKind, architecture);
  let observed: unknown;
  if (kind === 'memory') {
    assert.equal(state.OOMKilled, true); assert.equal(state.ExitCode, 137);
    observed = {oomKilled: true, exitCode: 137};
  } else if (kind === 'descendants') {
    assert.equal(state.OOMKilled, false); assert.equal(state.ExitCode, 137); assert(stopped && stopped.stopElapsedMs <= 10000);
    observed = {...stopped, exitCode: 137, pidNamespaceStopped: true};
  } else {
    assert.equal(state.OOMKilled, false); assert.equal(state.ExitCode, 0);
    observed = kind === 'cpu' ? cpuEvidence(row) : pidEvidence(row);
  }
  within(deadline);
  return {kind, status: 'passed', nodeVersion: row.node, vmMemoryAvailableKiB: row.vmMemoryAvailableKiB, controls: configured.controls, observed};
}
async function harnessIdentity() {
  const paths = ['tools/qualification/resources/controls.ts', 'tools/qualification/resources/programs.ts',
    'tools/qualification/resources/values.ts', 'tools/qualification/docker.ts', 'tools/delivery/files.ts',
    'tools/delivery/registry/value.ts', 'tools/delivery/registry/native-value.ts', 'tools/delivery/registry/descriptors.ts',
    'tools/delivery/identity.ts', 'package.json', 'package-lock.json'];
  const files: Record<string, string> = {};
  for (const path of paths) files[path] = (await deliveryDigest(resolve(path), 4 * 1024 ** 2)).sha256;
  const revision = execFileSync('git', ['rev-parse', 'HEAD'], {timeout: 10000, maxBuffer: 1024}).toString().trim();
  assert.match(revision, /^[a-f0-9]{40}$/);
  const dirty = execFileSync('git', ['status', '--porcelain', '--untracked-files=all', '--', ...paths], {timeout: 10000, maxBuffer: 65536}).toString().trim().length > 0;
  return {revision, dirty, node: process.version, hostPlatform: process.platform, files};
}
function argumentsFor(argv: string[]) {
  const [publication, output, context = 'default', extra] = argv;
  assert(publication && output && !extra && isAbsolute(publication) && isAbsolute(output));
  assert(/^[A-Za-z0-9_.-]{1,128}$/.test(context));
  return {publication, output, context};
}
async function main() {
  const {publication, output, context} = argumentsFor(process.argv.slice(2));
  const plan = capturePublishedPlan(await readDeliveryJson(publication));
  const architecture = qualificationArchitecture(process.arch, process.env.BEETLE_QUALIFICATION_ARCHITECTURE);
  const engine = plan.images.find(row => row.role === 'engine')!;
  const platform = engine.platforms.find(row => row.architecture === architecture)!;
  const image = `${plan.repository}@${engine.index.digest}`; const allowed = [engine.index.digest, platform.digest, platform.config];
  const docker = new Docker(context); const info = record(docker.json<unknown>(['info', '--format', '{{json .}}']));
  const daemonVersion = info.ServerVersion; const kernelVersion = info.KernelVersion;
  assert(typeof daemonVersion === 'string' && /^[A-Za-z0-9._+-]{1,80}$/.test(daemonVersion));
  assert(typeof kernelVersion === 'string' && /^[A-Za-z0-9._+-]{1,128}$/.test(kernelVersion));
  const vmMemoryBytes = counter(info.MemTotal);
  assert.equal(info.OSType, 'linux'); assert(['aarch64', 'arm64', 'x86_64', 'amd64'].includes(String(info.Architecture)));
  assert.equal(String(info.Architecture).replace('aarch64', 'arm64').replace('x86_64', 'amd64'), architecture); assert(counter(info.NCPU) >= 2);
  const images = docker.json<unknown[]>(['image', 'inspect', image]); assert.equal(images.length, 1);
  verifyLoadedImage(images[0], plan, 'engine', architecture as 'amd64' | 'arm64');
  await mkdir(output, {mode: 0o700}); const owner = 'beetle-resource-' + randomUUID();
  await writeFile(join(output, 'owner.json'), JSON.stringify({owner, image, revision: plan.revision, architecture, cases}), {flag: 'wx', mode: 0o600});
  const harness = await harnessIdentity();
  const fixture: Fixture = {docker, image, owner, allowed, architecture, output};
  const results: unknown[] = []; let status = 'failed'; let cleanupVerified = false; let phase: string = 'start';
  try {
    for (const kind of cases) {
      phase = kind; results.push(await runCase(fixture, kind));
      console.log(JSON.stringify({kind, status: 'passed'}));
    }
    status = 'passed';
  } catch (error) {
    await writeFile(join(output, 'failure-private.txt'), String(error instanceof Error ? error.stack : error).slice(0, 16384), {flag: 'wx', mode: 0o600});
    process.exitCode = 1;
  } finally {
    try {docker.cleanup(owner); cleanupVerified = true;} catch {status = 'failed'; process.exitCode = 1;}
    const outcome = {format: 'beetle-kernel-controls', version: 1, status, phase, cleanupVerified,
      revision: plan.revision, architecture, image, daemonVersion, kernelVersion, vmCpus: info.NCPU, vmMemoryBytes, harness, results,
      limits: ['Direct kernel controls, not installed-agent cause/reservation qualification', 'No flood/soak/overhead/recovery qualification']};
    await writeFile(join(output, 'outcome.json'), JSON.stringify(outcome, null, 2), {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({status, architecture, cleanupVerified}));
  }
}
main().catch(() => {console.error('Resource qualification failed; inspect owned evidence. No accepted result.'); process.exitCode = 1;});
