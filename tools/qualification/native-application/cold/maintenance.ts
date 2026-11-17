import assert from 'node:assert/strict';
import { join } from 'node:path';
import { writeFileSync } from 'node:fs';
import type { Fixture } from '../compose/fixture.js';
import type { RecoveryRequest } from '../../../recovery/src/request.js';
import { captureResumeRefusal } from './refusal.js';
export function maintenance(f: Fixture, owner: string) {
  const base = maintenanceBase(f, owner);
  const image = f.images.installer!;
  const work = join(f.home, 'recovery');
  const socket = '/var/run/docker.sock';
  const gid = f.docker.run([
    ...base,
    '--mount',
    `type=bind,source=${socket},target=${socket},readonly`,
    '--entrypoint',
    'node',
    image,
    '-e',
    "console.log(require('node:fs').statSync('/var/run/docker.sock').gid)",
  ]);
  assert(/^(0|[1-9][0-9]{0,8})$/.test(gid));
  f.docker.run([
    ...base,
    '--entrypoint',
    'node',
    image,
    '-e',
    "process.umask(0o077);require('node:fs').mkdirSync(process.argv[1],{mode:0o700})",
    work,
  ]);
  let sequence = 0;
  const create = requestWriter({ f, base, image, work, socket, gid, nextSequence: () => ++sequence });
  const cli = (request: RecoveryRequest) => {
    const id = create(request);
    try {
      return JSON.parse(f.docker.run(['start', '-a', id])) as unknown;
    } catch (error) {
      writeFileSync(join(f.root, `maintenance-${sequence}-private.txt`), f.docker.logs(id), {
        flag: 'wx',
        mode: 0o600,
      });
      throw error;
    }
  };
  const refuse = (request: Extract<RecoveryRequest, { command: 'restore' }>) => {
    assert.equal(request.resume, true);
    const id = create(request);
    f.docker.run(['start', id]);
    const exit = f.docker.run(['wait', id]);
    assert(/^(0|[1-9][0-9]{0,2})$/.test(exit));
    const rows = f.docker.json<
      { Id: string; Image: string; State: { Running: boolean; ExitCode: number; OOMKilled: boolean } }[]
    >(['inspect', id]);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.Id, id);
    assert.equal(row.Image, f.imageIds.installer);
    assert.equal(row.State.Running, false);
    assert.equal(row.State.ExitCode, Number(exit));
    const logs = f.docker.logs(id);
    writeFileSync(join(f.root, `maintenance-${sequence}-private.txt`), logs, { flag: 'wx', mode: 0o600 });
    return captureResumeRefusal({ exitCode: row.State.ExitCode, oomKilled: row.State.OOMKilled, logs });
  };
  const digest = (path: string) =>
    f.docker.run([
      ...base,
      '--entrypoint',
      'node',
      image,
      '-e',
      "const f=require('node:fs'),c=require('node:crypto');const p=process.argv[1];if(f.statSync(p).size>33554432)process.exit(3);console.log(c.createHash('sha256').update(f.readFileSync(p)).digest('hex'))",
      path,
    ]);
  return { base, image, work, cli, refuse, digest };
}

function maintenanceBase(f: Fixture, owner: string): string[] {
  const base = [
    'run',
    '--rm',
    '--pull',
    'never',
    '--network',
    'none',
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--cpus',
    '0.5',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--pids-limit',
    '64',
    '--user',
    '1000:1000',
    '--label',
    `dev.beetle.qualification=${owner}`,
    '--mount',
    `type=bind,source=${f.home},target=${f.home}`,
  ];
  return base;
}
function requestWriter({
  f,
  base,
  image,
  work,
  socket,
  gid,
  nextSequence,
}: {
  f: Fixture;
  base: string[];
  image: string;
  work: string;
  socket: string;
  gid: string;
  nextSequence(): number;
}) {
  const create = (request: RecoveryRequest) => {
    const path = join(work, `request-${nextSequence()}.json`);
    f.docker.run(
      [
        ...base,
        '-i',
        '--entrypoint',
        'node',
        image,
        '-e',
        "require('node:fs').writeFileSync(process.argv[1],require('node:fs').readFileSync(0),{flag:'wx',mode:0o600})",
        path,
      ],
      JSON.stringify(request),
    );
    const args = base.slice(1).filter((item) => item !== '--rm');
    const socketAccess =
      request.command === 'backup'
        ? ['--group-add', gid, '--mount', `type=bind,source=${socket},target=${socket},readonly`]
        : [];
    const id = f.docker.run([
      'create',
      ...args,
      ...socketAccess,
      '--entrypoint',
      'node',
      image,
      '/beetle/install/recovery.js',
      '--request',
      path,
    ]);
    assert(/^[a-f0-9]{64}$/.test(id));
    return id;
  };
  return create;
}
