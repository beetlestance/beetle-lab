/** Failure-only daemon diagnosis, never a product qualification or sampler change. */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir, writeFile} from 'node:fs/promises';
import {isAbsolute, join} from 'node:path';
import {UnixDockerTransport} from '../../../../agent/src/backends/docker/index.js';
import {readDeliveryJson} from '../../../delivery/files.js';
import {capturePublishedPlan} from '../../../delivery/registry/value.js';
import {verifyLoadedImage} from '../../../delivery/registry/native-value.js';
import {Docker} from '../../docker.js';
import {record, qualificationArchitecture} from '../../resources/values.js';
import {diagnosticFacts, diagnosticProgram} from './stats-values.js';
async function probes(transport: UnixDockerTransport, id: string) {
  const results = [];
  for (const budgetMs of [1000, 2000, 1000]) {
    const started = performance.now();
    const reply = await transport.request({method: 'GET', path: `/v1.47/containers/${id}/stats?stream=false&one-shot=true`, deadline: started + budgetMs});
    results.push({budgetMs, elapsedMs: Math.ceil(performance.now() - started), ...diagnosticFacts(reply, id)});
  }
  return results;
}
function argumentsFor(argv: string[]) {
  const [publication, output, extra] = argv; assert(publication && output && isAbsolute(publication) && isAbsolute(output) && !extra);
  return {publication, output};
}
async function main() {
  const {publication, output} = argumentsFor(process.argv.slice(2)); assert.equal(process.platform, 'linux');
  const architecture = qualificationArchitecture(process.arch, process.env.BEETLE_QUALIFICATION_ARCHITECTURE);
  const plan = capturePublishedPlan(await readDeliveryJson(publication)); const engine = plan.images.find(value => value.role === 'engine')!;
  const reference = `${plan.repository}@${engine.index.digest}`; const docker = new Docker('default');
  const images = docker.json<unknown[]>(['image', 'inspect', reference]); assert.equal(images.length, 1); verifyLoadedImage(images[0], plan, 'engine', architecture);
  const endpoint = docker.run(['context', 'inspect', 'default', '--format', '{{.Endpoints.docker.Host}}']); assert(endpoint.startsWith('unix://'));
  const daemon = record(docker.json<unknown>(['info', '--format', '{{json .}}']));
  assert(typeof daemon.ServerVersion === 'string' && /^[A-Za-z0-9._+-]{1,80}$/.test(daemon.ServerVersion));
  await mkdir(output, {mode: 0o700}); const owner = 'beetle-resource-' + randomUUID();
  await writeFile(join(output, 'owner.json'), JSON.stringify({owner, image: reference}), {flag: 'wx', mode: 0o600});
  let results: Awaited<ReturnType<typeof probes>> = []; let completed = false; let cleanupVerified = false;
  try {
    const id = docker.run(['create', '--pull', 'never', '--name', owner, '--label', `dev.beetle.qualification=${owner}`, '--cpus', '1',
      '--memory', '512m', '--memory-swap', '512m', '--pids-limit', '128', '--read-only', '--user', '1000:1000', '--cap-drop', 'ALL',
      '--security-opt', 'no-new-privileges:true', '--network', 'none', '--log-driver', 'none', '--entrypoint', 'node', reference, '-e', diagnosticProgram]);
    assert.match(id, /^[a-f0-9]{64}$/); docker.run(['start', id]);
    results = await probes(new UnixDockerTransport(endpoint.slice(7)), id); completed = true;
  } finally {
    try {docker.cleanup(owner); cleanupVerified = true;} catch {process.exitCode = 1;}
    await writeFile(join(output, 'outcome.json'), JSON.stringify({format: 'beetle-stats-diagnostic', version: 1, qualification: false,
      completed, cleanupVerified, sourceRevision: plan.revision, architecture, daemonVersion: daemon.ServerVersion, harnessNode: process.version,
      results, limits: ['Failure-only idle-container diagnosis; not qualification', 'Producer one-second deadline unchanged; two-second call is diagnostic only']}, null, 2), {flag: 'wx', mode: 0o600});
    console.log(JSON.stringify({completed, cleanupVerified, qualification: false}));
  }
}
main().catch(() => {console.error('Native stats diagnosis did not complete'); process.exitCode = 1;});
