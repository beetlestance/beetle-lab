import assert from 'node:assert/strict';
import {join} from 'node:path';
import {readFile, writeFile} from 'node:fs/promises';
import type {Fixture} from '../compose/fixture.js';
import type {ProvisionRequest} from '../../../install/types.js';
import {starterPolicy} from '../../../install/starter/policy.js';
import {starterExport} from '../../../install/starter/export.js';
import {longPolicy} from './policy.js';
import {provisionCommand} from './provision.js';
import {completedSetup} from './setup.js';
/** Packaged bootstrap establishes an owned parent; the public advanced CLI owns fresh child data. */
export async function advanced(f: Fixture, owner: string, context = 'default', progress: (stage: string) => void = () => undefined) {
 progress('bootstrap'); f.compose('up', '-d', '--no-build', 'setup'); completedSetup(f);
 const home = join(f.home, 'long-profile'); const requestPath = join(f.home, 'long-request.json');
 const base = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
  '--security-opt', 'no-new-privileges:true', '--cpus', '1', '--memory', '256m', '--memory-swap', '256m',
  '--pids-limit', '64', '--user', '1000:1000', '--label', `dev.beetle.qualification=${owner}`,
  '--mount', `type=bind,source=${f.home},target=${f.home}`];
 const policy = longPolicy();
 const request: ProvisionRequest = {...policy, root: join(home, 'data'), uid: 1000, gid: 1000, externalOrigin: f.origin,
  agentOrigin: 'http://agent:4312', dockerSocket: '/var/run/docker.sock', agentContainer: f.agent, agentImage: f.images.agent!,
  agentIdentity: 'socket-group-drop-v1', engineImage: f.images.engine!, targetNetwork: `beetle-${f.instance}-targets`,
  exportEngine: starterExport(starterPolicy().engine, f.images.offline!)};
 progress('write-request'); f.docker.run([...base, '-i', '--entrypoint', 'node', f.images.installer!, '-e',
  "const f=require('node:fs');process.umask(0o077);f.mkdirSync(process.argv[1],{mode:0o700});f.writeFileSync(process.argv[2],f.readFileSync(0),{flag:'wx',mode:0o600})", home, requestPath], JSON.stringify(request));
 const socket = '/var/run/docker.sock'; const access = ['--mount', `type=bind,source=${socket},target=${socket},readonly`];
 progress('socket-group'); const gid = f.docker.run([...base, ...access, '--entrypoint', 'node', f.images.installer!, '-e', "console.log(require('node:fs').statSync('/var/run/docker.sock').gid)"]);
 assert(/^(0|[1-9][0-9]{0,8})$/.test(gid));
 progress('provision'); const provisioned: unknown = JSON.parse(provisionCommand(context, [...base, ...access, '--group-add', gid, '--entrypoint', 'node', f.images.installer!,
  '/beetle/install/main.js', '--request', requestPath, '--agent-worker', '/beetle/install/agent-worker.js', '--backend-worker', '/beetle/install/backend-worker.js']));
 assert(provisioned && typeof provisioned === 'object' && 'installationId' in provisioned && typeof provisioned.installationId === 'string');
 assert.match(provisioned.installationId, /^[a-f0-9-]{36}$/);
 progress('compose-override'); const env = join(f.root, 'compose.env'); const prior = await readFile(env, 'utf8');
 assert(prior.includes(`BEETLE_HOME='${f.home}'\n`));
 await writeFile(env, prior.replace(`BEETLE_HOME='${f.home}'\n`, `BEETLE_HOME='${home}'\n`), {mode: 0o600});
 const override = join(f.root, 'target.json'); const target = JSON.parse(await readFile(override, 'utf8')) as {services: Record<string, unknown>};
 // Advanced provisioning already succeeded. Do not run default-policy ready inspection on another policy.
 target.services.setup = {entrypoint: ['node', '-e', 'process.exit(0)'], user: '1000:1000', cap_add: [], cap_drop: ['ALL']};
 await writeFile(override, JSON.stringify(target), {mode: 0o600});
 return {f: {...f, home}, installationId: provisioned.installationId, policy: request};
}
