/** Manual real-daemon exercise. Never invoked by unit tests or ordinary application startup. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { validate } from '@beetle/contracts';
import type { AttemptSnapshot } from '@beetle/contracts';
import { Docker, request } from './docker.js';
import type { Inspection } from './docker.js';
import { fixture, saveConfiguration } from './fixture.js';
import type { Fixture } from './fixture.js';
import { check, released } from './assertions.js';

const [agentImage, engineImage, status = '200', context = 'default'] = process.argv.slice(2);
if (!agentImage || !engineImage || !['200', '500'].includes(status) || process.argv.length > 6) {
  throw new Error('Usage: smoke-agent.ts AGENT_IMAGE ENGINE_IMAGE [200|500] [LOCAL_CONTEXT]');
}
const f = await fixture(new Docker(context), agentImage, engineImage, Number(status));
const evidence: Record<string, unknown> = { status: 'running', architecture: f.architecture, workStatus: f.workStatus,
  agentImage: f.agentImage.Id, engineImage: f.engineImage.Id, daemonVersion: f.info.ServerVersion,
  daemon: 'real', engineExecutions: null, cleanupVerified: false, phase: 'provision' };
const pause = () => new Promise(resolve => setTimeout(resolve, 250));
function startTarget(): void {
  const program = `require('node:http').createServer((q,r)=>{r.writeHead(q.url==='/ready'?200:q.url==='/work'?${f.workStatus}:404);r.end('ok')}).listen(8080,'0.0.0.0');`;
  f.docker.run(['run', '-d', '--pull', 'never', '--name', f.target, '--label', `dev.beetle.qualification=${f.id}`,
    '--network', f.network, '--network-alias', 'target', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--cpus', '0.5', '--memory', '128m', '--pids-limit', '64', '--entrypoint', 'node', f.agentImage.Id, '-e', program]);
}
async function startAgent(): Promise<void> {
  const mounts = ['staging', 'journal', 'inputs', 'config'].flatMap(name => ['--mount',
    `type=bind,src=${join(f.root, name)},dst=${join(f.root, name)}${['inputs', 'config'].includes(name) ? ',readonly' : ''}`]);
  f.docker.run(['create', '--pull', 'never', '--name', f.agent, '--label', `dev.beetle.qualification=${f.id}`, '--network', f.network,
    '--user', f.user, '--group-add', '0', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--cpus', '1', '--memory', '512m', '--pids-limit', '128', '--tmpfs', `/tmp:rw,nosuid,nodev,size=33554432,uid=${f.uid},gid=${f.gid}`,
    ...mounts, '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock', '--env', `BEETLE_AGENT_CONFIG_FILE=${f.configPath}`, f.agentImage.Id]);
  const actual = f.docker.json<Inspection[]>(['inspect', f.agent])[0]!; assert.equal(actual.Image, f.agentImage.Id);
  await saveConfiguration(f, actual.Image); f.docker.run(['start', f.agent]);
}
async function ready(): Promise<void> {
  const deadline = Date.now() + 25000;
  while (Date.now() < deadline) {
    try { if (request(f.docker, { agent: f.agent, credentialFile: f.tokenPath, path: '/runner/v1/capabilities' }).status === 200) return; }
    catch { /* Inspect original process below. */ }
    assert(f.docker.json<Inspection[]>(['inspect', f.agent])[0]!.State.Running, 'Agent exited before readiness');
    await pause();
  }
  throw new Error('Agent readiness expired');
}
async function execute(): Promise<AttemptSnapshot> {
  const path = `/runner/v1/attempts/${f.offer.attemptId}`;
  const headers = { 'content-type': 'application/json', 'x-beetle-organization-id': f.offer.organizationId,
    'x-beetle-workspace-id': f.offer.workspaceId, 'x-beetle-generation': '1' };
  const input = { agent: f.agent, credentialFile: f.tokenPath, headers, path };
  assert.equal(request(f.docker, { ...input, method: 'PUT', body: f.offer }).status, 202);
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const response = request(f.docker, input); assert.equal(response.status, 200);
    const snapshot = validate('AttemptSnapshot', JSON.parse(response.body)); assert(snapshot.ok);
    if (snapshot.value.state === 'exited' && released(f)) return snapshot.value;
    await pause();
  }
  throw new Error('Attempt did not finish and release before qualification deadline');
}
async function captureLogs(input: Fixture): Promise<void> {
  for (const id of input.docker.ownedIds(input.id)) {
    try { await writeFile(join(input.root, `container-${id}-logs.txt`), input.docker.run(['logs', id]), { mode: 0o600 }); }
    catch { /* Optional bounded diagnostics never replace the checked run/release/cleanup evidence. */ }
  }
}
try {
  f.docker.run(['network', 'create', '--internal', '--label', `dev.beetle.qualification=${f.id}`, f.network]);
  startTarget(); await startAgent(); evidence.phase = 'readiness'; await ready();
  evidence.phase = 'execution'; const snapshot = await execute(); evidence.phase = 'verification';
  await writeFile(join(f.root, 'snapshot.json'), JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  Object.assign(evidence, await check(f, snapshot), { engineExecutions: 1 });
  f.docker.run(['stop', '-t', '10', f.agent]);
  assert.equal(f.docker.json<Inspection[]>(['inspect', f.agent])[0]!.State.ExitCode, 0);
  assert(released(f)); evidence.status = 'passed'; evidence.phase = 'finished';
} catch { evidence.status = 'failed'; process.exitCode = 1; }
finally {
  try { await captureLogs(f); } catch { /* Keep independent cleanup attempt below. */ }
  try { f.docker.cleanup(f.id); evidence.cleanupVerified = true; }
  catch { evidence.cleanupVerified = false; evidence.status = 'failed'; process.exitCode = 1; }
  await writeFile(join(f.root, 'evidence.json'), JSON.stringify(evidence, null, 2), { mode: 0o600 });
  process.stdout.write(JSON.stringify({ status: evidence.status, evidenceDirectory: f.root, cleanupVerified: evidence.cleanupVerified }) + '\n');
}
