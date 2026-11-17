import assert from 'node:assert/strict';
import { join } from 'node:path';
import type { Fixture } from '../compose/fixture.js';
import type { ProvisionRequest } from '../../../install/types.js';
import { starterPolicy } from '../../../install/starter/policy.js';
import { starterExport } from '../../../install/starter/export.js';
export const volumeOptions = 'size=67108864,uid=1000,gid=1000,mode=0700';
/** Only the explicit test's free-space reserve differs from the shipped policy. */
export function request(f: Fixture): ProvisionRequest {
  const policy = starterPolicy();
  return {
    ...policy,
    root: join(f.home, 'data'),
    uid: 1000,
    gid: 1000,
    externalOrigin: f.origin,
    agentOrigin: 'http://agent:4312',
    dockerSocket: '/var/run/docker.sock',
    agentContainer: f.agent,
    agentImage: f.images.agent!,
    agentIdentity: 'socket-group-drop-v1',
    engineImage: f.images.engine!,
    targetNetwork: `beetle-${f.instance}-targets`,
    exportEngine: starterExport(policy.engine, f.images.offline!),
    installationValues: {
      ...policy.installationValues,
      pool: { ...policy.installationValues.pool, freeSpaceReserveBytes: 0 },
    },
  };
}
/** Task volume only:64MiB maximum, no bind of a user's filesystem or daemon-wide fill. */
export function setup(f: Fixture, owner: string) {
  const volume = `${f.project}-disk`;
  const network = `beetle-${f.instance}-targets`;
  assert.equal(f.docker.run(['volume', 'ls', '-q', '--filter', `name=^${volume}$`]), '');
  assert.equal(f.docker.run(['network', 'ls', '-q', '--filter', `name=^${network}$`]), '');
  const labels = ['--label', `dev.beetle.qualification=${owner}`, '--label', `com.docker.compose.project=${f.project}`];
  const base = diskContainerArgs(labels);
  const image = f.images.installer!;
  const available = Number(
    f.docker.run([
      ...base,
      '--entrypoint',
      'node',
      image,
      '-e',
      "const s=require('node:fs').readFileSync('/proc/meminfo','utf8');console.log(Number(/^MemAvailable:\\s+([0-9]+) kB$/m.exec(s)?.[1])*1024)",
    ]),
  );
  assert(Number.isSafeInteger(available) && available >= 1610612736);
  f.docker.run([
    'volume',
    'create',
    ...labels,
    '--driver',
    'local',
    '--opt',
    'type=tmpfs',
    '--opt',
    'device=tmpfs',
    '--opt',
    `o=${volumeOptions}`,
    volume,
  ]);
  f.docker.run(['network', 'create', ...labels, network]);
  const mounted = [...base, '--mount', `type=volume,source=${volume},target=${f.home}`];
  // A local tmpfs must stay mounted continuously, or sequential helpers lose its contents.
  const keeper = f.docker.run([...mounted, '-d', '--entrypoint', 'node', image, '-e', 'setTimeout(()=>{},660000)']);
  assert.match(keeper, /^[a-f0-9]{64}$/);
  const kept = f.docker.json<{ State: { Running: boolean }; Mounts: { Name?: string; Destination: string }[] }[]>([
    'inspect',
    keeper,
  ])[0]!;
  assert(kept.State.Running && kept.Mounts.some((mount) => mount.Name === volume && mount.Destination === f.home));
  const input = request(f);
  const path = join(f.home, 'request.json');
  f.docker.run(
    [
      ...mounted,
      '-i',
      '--entrypoint',
      'node',
      image,
      '-e',
      "const f=require('node:fs');const p=process.argv[1],s=f.statSync(p);if(s.uid!==1000||s.gid!==1000||(s.mode&511)!==448)process.exit(3);f.writeFileSync(process.argv[2],f.readFileSync(0),{flag:'wx',mode:0o600})",
      f.home,
      path,
    ],
    JSON.stringify(input),
  );
  const installationId = provisionDisk(f, mounted, image, path);
  return { volume, network, keeper, base: mounted, image, availableBeforeBytes: available, installationId };
}
export function startBackend(f: Fixture, owner: string, volume: string, network: string) {
  const id = f.docker.run([
    'run',
    '-d',
    '--pull',
    'never',
    '--network',
    network,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--cpus',
    '1',
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
    '--label',
    `com.docker.compose.project=${f.project}`,
    '--mount',
    `type=volume,source=${volume},target=${f.home}`,
    '--publish',
    `127.0.0.1:${new URL(f.origin).port}:4311`,
    '--env',
    `BEETLE_CONFIG_FILE=${join(f.home, 'data/config/installation.json')}`,
    '--env',
    `BEETLE_AGENT_CONFIG_FILE=${join(f.home, 'data/config/backend-agent.json')}`,
    '--env',
    `BEETLE_DATA_DIR=${join(f.home, 'data/backend')}`,
    '--env',
    'BEETLE_LOCAL_ACCESS=automatic',
    '--env',
    `BEETLE_EXTERNAL_ORIGIN=${f.origin}`,
    '--env',
    'BEETLE_LISTEN_HOST=0.0.0.0',
    '--log-driver',
    'local',
    '--log-opt',
    'max-size=1m',
    '--log-opt',
    'max-file=2',
    f.images.backend!,
  ]);
  assert.match(id, /^[a-f0-9]{64}$/);
  return id;
}

function diskContainerArgs(labels: readonly string[]): string[] {
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
    '1',
    '--memory',
    '256m',
    '--memory-swap',
    '256m',
    '--pids-limit',
    '64',
    '--user',
    '1000:1000',
    ...labels,
  ];
  return base;
}
function provisionDisk(f: Fixture, mounted: string[], image: string, path: string): string {
  const socket = '/var/run/docker.sock';
  const access = ['--mount', `type=bind,source=${socket},target=${socket},readonly`];
  const gid = f.docker.run([
    ...mounted,
    ...access,
    '--entrypoint',
    'node',
    image,
    '-e',
    "console.log(require('node:fs').statSync('/var/run/docker.sock').gid)",
  ]);
  assert(/^(0|[1-9][0-9]{0,8})$/.test(gid));
  const result: unknown = JSON.parse(
    f.docker.run([
      ...mounted,
      ...access,
      '--group-add',
      gid,
      '--entrypoint',
      'node',
      image,
      '/beetle/install/main.js',
      '--request',
      path,
      '--agent-worker',
      '/beetle/install/agent-worker.js',
      '--backend-worker',
      '/beetle/install/backend-worker.js',
    ]),
  );
  assert(
    result && typeof result === 'object' && 'installationId' in result && typeof result.installationId === 'string',
  );
  assert.match(result.installationId, /^[a-f0-9-]{36}$/);

  return result.installationId;
}
