/** Manual private-network engine exercise; no publication or full-agent qualification. */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { validate, verifyEngineResultSeal } from '@beetle/contracts';
import type { EngineResult } from '@beetle/contracts';
import { stagedFixture } from '../native-process/staged-fixture.js';
import { docker, limits, Resources } from './docker.js';
import * as programs from './programs.js';

interface FileEvidence { bytes: number; sha256: string; text: string }
interface Evidence { node: string; platform: string; arch: string; uid: number; files: Record<string, FileEvidence> }
const requestedImage = process.argv[2]; if (!requestedImage) throw new Error('Provide an already-built local engine image');
const imageInfo = JSON.parse(docker(['image', 'inspect', requestedImage])) as { Id: string; Architecture: string; Os: string }[];
const image = imageInfo[0]!.Id;
assert.equal(imageInfo[0]!.Os, 'linux'); assert.equal(imageInfo[0]!.Architecture, 'arm64');
assert.match(docker(['info', '--format', '{{.OSType}}/{{.Architecture}}']), /^linux\/(arm64|aarch64)$/);
const evidenceRoot = await mkdtemp(join(tmpdir(), 'beetle-engine-evidence-'));
const hash = (text: string): string => createHash('sha256').update(text).digest('hex');

function check(evidence: Evidence, status: number, scope: Pick<EngineResult, 'organizationId' | 'workspaceId' | 'attemptId' | 'generation'>): void {
  assert.match(evidence.node, /^v24\./); assert.equal(evidence.platform, 'linux');
  assert.equal(evidence.arch, 'arm64'); assert.equal(evidence.uid, 1000);
  const result = verifyEngineResultSeal(JSON.parse(evidence.files['engine-result.json']!.text), hash);
  assert(result.ok); assert.equal(result.value.outcome, status === 200 ? 'passed' : 'failed');
  assert.equal(result.value.execution.exitCode, status === 200 ? 0 : 99);
  assert.deepEqual(result.value.requiredAssertions, { required: 1, passed: Number(status === 200), failed: Number(status === 500), unknown: 0 });
  assert.equal(result.value.completeness, 'complete');
  for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) assert.equal(result.value[key], scope[key]);
  assert.deepEqual(result.value.artifacts.map(value => value.relativePath).sort(), ['beetle-evidence.json', 'numeric-final.json']);
  for (const artifact of result.value.artifacts) {
    const actual = evidence.files[artifact.relativePath]!;
    assert.equal(actual.bytes, artifact.bytes); assert.equal(actual.sha256, artifact.sha256);
  }
  const summary = JSON.parse(evidence.files['beetle-evidence.json']!.text) as { metrics: Record<string, { values: { count: number } }> };
  assert.equal(summary.metrics.http_reqs!.values.count, 1);
  const events = evidence.files['control.ndjson']!.text.trimEnd().split('\n').map(line => {
    const value = validate('ControlEvent', JSON.parse(line)); assert(value.ok);
    for (const key of ['organizationId', 'workspaceId', 'attemptId', 'generation'] as const) assert.equal(value.value[key], scope[key]);
    return value.value;
  });
  assert.deepEqual(events.map(event => event.seq), events.map((_, index) => index + 1));
  assert.deepEqual(events.filter(event => event.kind === 'phase.started').map(event => event.phase),
    ['validate', 'prepare', 'execute', 'collect', 'seal']);
  assert.deepEqual(events.filter(event => event.kind === 'phase.finished').map(event => event.phase),
    ['validate', 'prepare', 'execute', 'collect', 'seal']);
  assert.equal(events.at(-1)?.kind, 'phase.finished'); assert.equal(events.at(-1)?.phase, 'seal');
  const terminal = events.find(event => event.kind === 'engine.result'); assert(terminal?.kind === 'engine.result');
  assert.deepEqual(terminal.payload, result.value);
}
function probe(resources: Resources): unknown {
  const raw = docker(['run', '--name', resources.containers[4]!, ...resources.labels, ...limits,
    '--network', 'none', '--entrypoint', 'node', image!, '--input-type=commonjs', '-e', programs.kernel]);
  const value = JSON.parse(raw) as { node: string; arch: string; uid: number; esbuild: string; controls: Record<string, string> };
  assert.match(value.node, /^v24\./); assert.equal(value.arch, 'arm64'); assert.equal(value.uid, 1000);
  assert.equal(value.esbuild, '0.28.2'); assert.equal(value.controls['memory.max'], '536870912');
  assert.equal(value.controls['memory.swap.max'], '0'); assert.equal(value.controls['pids.max'], '128');
  const cpu = value.controls['cpu.max']!.split(' ').map(Number); assert.equal(cpu[0]! / cpu[1]!, 1);
  assert.match(docker(['run', '--name', resources.containers[5]!, ...resources.labels, ...limits,
    '--network', 'none', '--entrypoint', '/usr/local/bin/k6', image!, 'version']), /^k6 v2\.2\.0\b/);
  return value;
}
async function run(status: number): Promise<void> {
  const resources = new Resources(); let failure: unknown;
  try {
    resources.create(); const kernel = probe(resources);
    docker(['run', '--detach', '--name', resources.containers[0]!, ...resources.labels, ...limits,
      '--network', resources.network, '--network-alias', 'target', '--env', `WORK_STATUS=${status}`,
      '--entrypoint', 'node', image!, '--input-type=commonjs', '-e', programs.target]);
    const fixture = await stagedFixture('http://target:8080', 30_000);
    const files: Record<string, string> = {};
    for (const name of ['offer.json', 'manifest.json', 'staging.json']) files[name] = await readFile(join(fixture.options.inputRoot, name), 'utf8');
    docker(['run', '--interactive', '--name', resources.containers[1]!, ...resources.labels, ...limits,
      '--network', 'none', '--user', '0:0', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
      ...resources.mount(0, '/beetle/input'), ...resources.mount(1, '/beetle/secrets'), ...resources.mount(2, '/beetle/output'),
      '--entrypoint', 'node', image!, '--input-type=commonjs', '-e', programs.stage], JSON.stringify(files));
    docker(['create', '--name', resources.containers[2]!, ...resources.labels, ...limits, '--network', resources.network,
      ...resources.mount(0, '/beetle/input', true), ...resources.mount(1, '/beetle/secrets', true),
      ...resources.mount(2, '/beetle/output'), image!]);
    docker(['start', resources.containers[2]!]); const exit = docker(['wait', resources.containers[2]!]);
    const observation = resources.inspect(resources.containers[2]!);
    await writeFile(join(evidenceRoot, `${status}-observation.json`), JSON.stringify(observation, null, 2), { flag: 'wx', mode: 0o600 });
    assert.equal(exit, '0');
    const state = observation.State as { Running: boolean; OOMKilled: boolean; ExitCode: number };
    assert.equal(state.Running, false); assert.equal(state.OOMKilled, false); assert.equal(state.ExitCode, 0);
    const configured = observation.HostConfig as { NanoCpus: number; Memory: number; MemorySwap: number; PidsLimit: number; ReadonlyRootfs: boolean };
    assert.equal(configured.NanoCpus, 1_000_000_000); assert.equal(configured.Memory, 536_870_912);
    assert.equal(configured.MemorySwap, 536_870_912); assert.equal(configured.PidsLimit, 128); assert.equal(configured.ReadonlyRootfs, true);
    const raw = docker(['run', '--name', resources.containers[3]!, ...resources.labels, ...limits, '--network', 'none',
      ...resources.mount(2, '/beetle/output', true), '--entrypoint', 'node', image!, '--input-type=commonjs', '-e', programs.read]);
    const evidence = JSON.parse(raw) as Evidence; check(evidence, status, fixture.staging);
    const counts = JSON.parse(docker(['exec', resources.containers[0]!, 'node', '--input-type=commonjs', '-e',
      "fetch('http://127.0.0.1:8080/counts').then(r=>r.text()).then(console.log).catch(()=>process.exit(1))"]));
    assert.deepEqual(counts, { ready: 1, work: 1 });
    await writeFile(join(evidenceRoot, `${status}.json`), JSON.stringify({ image: imageInfo[0], kernel, counts, observation, evidence }, null, 2), { flag: 'wx', mode: 0o600 });
    console.log(JSON.stringify({ status, counts, node: evidence.node, arch: evidence.arch, evidenceRoot }));
  } catch (error) { failure = error; }
  try { resources.cleanup(failure !== undefined); } catch (error) { failure = new AggregateError([failure, error], 'Owned qualification cleanup failed'); }
  if (failure !== undefined) { console.error(`Retained owned resources: ${resources.id}`); throw failure; }
}
for (const status of [200, 500]) await run(status);
