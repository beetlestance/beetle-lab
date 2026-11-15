import assert from 'node:assert/strict';
import {join} from 'node:path';
import {writeFileSync} from 'node:fs';
import type {Fixture} from '../compose/fixture.js';
import type {RecoveryRequest} from '../../../recovery/src/request.js';
export function maintenance(f: Fixture, owner: string) {
  const base = ['run', '--rm', '--pull', 'never', '--network', 'none', '--read-only', '--cap-drop', 'ALL',
    '--security-opt', 'no-new-privileges:true', '--cpus', '0.5', '--memory', '256m', '--memory-swap', '256m',
    '--pids-limit', '64', '--user', '1000:1000', '--label', `dev.beetle.qualification=${owner}`,
    '--mount', `type=bind,source=${f.home},target=${f.home}`];
  const image = f.images.installer!; const work = join(f.home, 'recovery');
  const socket = '/var/run/docker.sock';
  const gid = f.docker.run([...base, '--mount', `type=bind,source=${socket},target=${socket},readonly`, '--entrypoint', 'node', image,
    '-e', "console.log(require('node:fs').statSync('/var/run/docker.sock').gid)"]);
  assert(/^(0|[1-9][0-9]{0,8})$/.test(gid));
  f.docker.run([...base, '--entrypoint', 'node', image, '-e',
    "process.umask(0o077);require('node:fs').mkdirSync(process.argv[1],{mode:0o700})", work]);
  let sequence = 0;
  const cli = (request: RecoveryRequest) => {
    const path = join(work, `request-${++sequence}.json`);
    f.docker.run([...base, '-i', '--entrypoint', 'node', image, '-e',
      "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0),{flag:'wx',mode:0o600})", path], JSON.stringify(request));
    const args = base.slice(1).filter(item => item !== '--rm');
    const socketAccess = request.command === 'backup' ? ['--group-add', gid, '--mount', `type=bind,source=${socket},target=${socket},readonly`] : [];
    const id = f.docker.run(['create', ...args, ...socketAccess,
      '--entrypoint', 'node', image, '/beetle/install/recovery.js', '--request', path]);
    assert(/^[a-f0-9]{64}$/.test(id));
    try {return JSON.parse(f.docker.run(['start', '-a', id])) as unknown;}
    catch (error) {writeFileSync(join(f.root, `maintenance-${sequence}-private.txt`), f.docker.logs(id), {flag: 'wx', mode: 0o600}); throw error;}
  };
  const digest = (path: string) => f.docker.run([...base, '--entrypoint', 'node', image, '-e',
    "const f=require('node:fs'),c=require('node:crypto');const p=process.argv[1];if(f.statSync(p).size>33554432)process.exit(3);console.log(c.createHash('sha256').update(f.readFileSync(p)).digest('hex'))", path]);
  return {base, image, work, cli, digest};
}
