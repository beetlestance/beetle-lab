import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { saveConfiguration } from '../../../agent/test/container/fixture.js';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import type { Inspection } from '../../../agent/test/container/docker.js';
import { agentOrigin } from './configuration.js';
import { initializeFreshInstallation } from './initialize.js';

export async function provision(f: Fixture, maximumTargetRequests = 4): Promise<string> {
  assert(Number.isSafeInteger(maximumTargetRequests) && maximumTargetRequests >= 1 && maximumTargetRequests <= 64);
  f.docker.run(['network', 'create', '--internal', '--label', `dev.beetle.qualification=${f.id}`, f.network]);
  const control = `beetle-control-${f.id}`;
  f.docker.run(['network', 'create', '--driver', 'bridge', '--label', `dev.beetle.qualification=${f.id}`, control]);
  const program = `const counts={ready:0,work:0,unexpected:0};require('node:http').createServer((q,r)=>{
if(q.url==='/counts'){r.end(JSON.stringify(counts));return;}
const key=q.url==='/ready'?'ready':q.url==='/work'?'work':'unexpected';
if(++counts[key]>${maximumTargetRequests})process.exit(3);r.writeHead(key==='ready'?200:key==='work'?${f.workStatus}:404);r.end('ok');
}).listen(8080,'0.0.0.0');`;
  f.docker.run(['run', '-d', '--pull', 'never', '--name', f.target, '--label', `dev.beetle.qualification=${f.id}`,
    '--network', f.network, '--network-alias', 'target', '--read-only', '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true',
    '--cpus', '0.5', '--memory', '128m', '--pids-limit', '64', '--log-driver', 'local', '--log-opt', 'max-size=1m',
    '--log-opt', 'max-file=2', '--entrypoint', 'node', f.agentImage.Id, '-e', program]);
  await createAgent(f, control);
  return agentOrigin(f.docker.run(['port', f.agent, '4312/tcp']));
}
async function createAgent(f: Fixture, control: string): Promise<void> {
  const mounts = ['staging', 'journal', 'inputs', 'config'].flatMap(name => ['--mount',
    `type=bind,src=${join(f.root, name)},dst=${join(f.root, name)}${['inputs', 'config'].includes(name) ? ',readonly' : ''}`]);
  f.docker.run(['create', '--pull', 'never', '--name', f.agent, '--label', `dev.beetle.qualification=${f.id}`, '--network', control,
    '--publish', '127.0.0.1::4312', '--user', f.user, '--group-add', '0', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--cpus', '1', '--memory', '512m', '--pids-limit', '128',
    '--log-driver', 'local', '--log-opt', 'max-size=1m', '--log-opt', 'max-file=2',
    '--tmpfs', `/tmp:rw,nosuid,nodev,size=33554432,uid=${f.uid},gid=${f.gid}`, ...mounts,
    '--mount', 'type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock',
    '--env', `BEETLE_AGENT_CONFIG_FILE=${f.configPath}`, f.agentImage.Id]);
  const actual = f.docker.json<Inspection[]>(['inspect', f.agent])[0]!; assert.equal(actual.Image, f.agentImage.Id);
  await saveConfiguration(f, actual.Image);
  const config = JSON.parse(await readFile(f.configPath, 'utf8')) as { listen: { host: string; port: number } };
  config.listen.host = '0.0.0.0'; await writeFile(f.configPath, JSON.stringify(config), { mode: 0o600 });
  await initializeFreshInstallation(f);
  f.docker.run(['start', f.agent]);
}
export function targetCounts(f: Fixture, expected = { ready: 1, work: 1, unexpected: 0 }): unknown {
  const program = `fetch('http://127.0.0.1:8080/counts',{signal:AbortSignal.timeout(2000)}).then(async r=>{
if(r.status!==200)throw Error('counts status');const reader=r.body.getReader();let text='',bytes=0;
for(let calls=0;calls<16;calls++){const p=await reader.read();if(p.done){console.log(text);return;}
bytes+=p.value.length;if(bytes>256){await reader.cancel();throw Error('counts limit');}text+=Buffer.from(p.value).toString();}
await reader.cancel();throw Error('counts fragments');}).catch(()=>process.exit(2));`;
  const counts: unknown = JSON.parse(f.docker.run(['exec', f.target, 'node', '-e', program]));
  assert.deepEqual(counts, expected); return counts;
}
export async function captureLogs(f: Fixture): Promise<string[]> {
  const failures: string[] = [];
  for (const id of f.docker.ownedIds(f.id)) {
    try { await writeFile(join(f.root, `container-${id}-inspect.json`), JSON.stringify(f.docker.json(['inspect', id]), null, 2), {mode: 0o600}); }
    catch { failures.push(`inspect:${id}`); }
    try { await writeFile(join(f.root, `container-${id}-logs.txt`), f.docker.run(['logs', '--tail', '100', id]), { mode: 0o600 }); }
    catch { failures.push(`logs:${id}`); }
  }
  return failures;
}
