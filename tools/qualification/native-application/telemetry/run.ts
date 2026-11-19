import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve, isAbsolute } from 'node:path';
import { randomUUID } from 'node:crypto';
import { UnixDockerTransport } from '../../../../agent/src/backends/docker/index.js';
import { candidate } from '../load/candidate.js';
import { composeProcesses } from '../compose/process.js';
import { cleanup } from '../compose/evidence.js';
import { cleanupLiveVolumes } from '../live-volumes.js';
import { readDeliveryJson } from '../../../delivery/files.js';
import { record } from '../../resources/values.js';
import { overlay } from './build.js';
import { target } from './target.js';
import { observe } from './observe.js';
import { environment } from './environment.js';
import { diagnosis } from './diagnosis.js';
import { comparison } from './compare.js';
const execute = promisify(execFile);
const [bundlePath, output, context = 'default', extra] = process.argv.slice(2);
assert(bundlePath && output && isAbsolute(bundlePath) && isAbsolute(output) && !extra);
const { f: base } = await candidate(bundlePath, context);
await mkdir(output, { mode: 0o700 });
await writeFile(
  join(output, 'owner.json'),
  JSON.stringify({ root: base.root, project: base.project, revision: base.revision, owner: randomUUID() }),
  { flag: 'wx', mode: 0o600 },
);
let agentId: string | undefined;
let f = base;
let built: Awaited<ReturnType<typeof overlay>> | undefined;
let installation: string | undefined;
let status = 'failed';
let phase = 'build';
const results: Record<string, unknown> = {};
try {
  built = await overlay(f, output);
  results.overlay = { id: built.id, baseImageId: f.imageIds.agent, bundle: built.bundle };
  const override = join(output, 'telemetry.json');
  const oracle = await target(override, built.tag);
  results.targetSourceSha256 = oracle.sourceSha256;
  f = {
    ...f,
    ...composeProcesses(
      context,
      [
        'compose',
        '--project-name',
        f.project,
        '--env-file',
        join(f.root, 'compose.env'),
        '--file',
        resolve('docker-compose.yml'),
        '--file',
        join(f.root, 'target.json'),
        '--file',
        override,
      ],
      f.root,
    ),
  };
  phase = 'setup';
  f.compose('up', '-d', '--no-build', 'setup', 'synthetic-target');
  const setup = f.compose('ps', '-a', '-q', 'setup');
  assert(/^[a-f0-9]{64}$/.test(setup));
  assert.equal(f.docker.run(['wait', setup]), '0');
  const setupState = f.docker.json<{ State: { ExitCode: number; OOMKilled: boolean } }[]>(['inspect', setup])[0]!;
  assert.equal(setupState.State.ExitCode, 0);
  assert.equal(setupState.State.OOMKilled, false);
  const config = record(await readDeliveryJson(join(f.home, 'data/config/agent.json')));
  installation = record(config.installation).installationId as string;
  assert(/^[a-f0-9-]{36}$/.test(installation));
  await writeFile(
    join(output, 'installation-owner.json'),
    JSON.stringify({ project: f.project, installationId: installation }),
    { flag: 'wx', mode: 0o600 },
  );
  phase = 'trials';
  f.compose('up', '-d', '--no-build', '--no-deps', 'agent');
  const agent = f.compose('ps', '-q', 'agent');
  agentId = agent;
  assert(/^[a-f0-9]{64}$/.test(agent));
  const actual = f.docker.json<
    {
      Image: string;
      HostConfig: { NanoCpus: number; Memory: number; PidsLimit: number };
      HostConfigRestart?: unknown;
    }[]
  >(['inspect', agent])[0]!;
  assert.equal(actual.Image, built.id);
  assert.deepEqual(
    [actual.HostConfig.NanoCpus, actual.HostConfig.Memory, actual.HostConfig.PidsLimit],
    [1000000000, 268435456, 64],
  );
  const socket = f.docker.run(['context', 'inspect', context, '--format', '{{.Endpoints.docker.Host}}']);
  assert(socket.startsWith('unix://'));
  const transport = new UnixDockerTransport(socket.slice(7));
  const env: NodeJS.ProcessEnv = { ...process.env, DOCKER_API_VERSION: '1.47' };
  delete env.DOCKER_HOST;
  delete env.DOCKER_CONTEXT;
  let terminal = false;
  const wait = execute('docker', ['--context', context, 'wait', agent], {
    env,
    timeout: 480000,
    maxBuffer: 4096,
    encoding: 'utf8',
  })
    .then((value) => {
      assert.equal(value.stdout.trim(), '0');
    })
    .finally(() => {
      terminal = true;
    });
  void wait.catch(() => undefined);
  const flags: unknown[] = [];
  const observed = await Promise.allSettled([
    wait,
    observe({
      context,
      id: agent,
      markerPath: join(f.home, 'data/agent/journal/telemetry-marker.json'),
      transport,
      terminal: () => terminal,
      environment: (_index, id, mode) => {
        flags.push(environment(f, installation!, id, mode));
      },
      failed: () => {
        const state = f.docker.json<{ Image: string; State: { Running: boolean } }[]>(['inspect', agent])[0]!;
        assert.equal(state.Image, built!.id);
        if (state.State.Running) {
          results.containmentStop = true;
          f.docker.run(['kill', '--signal', 'KILL', agent]);
        } else results.agentAlreadyStopped = true;
      },
    }),
  ]);
  results.nativeOriginals = observed.map((row) =>
    row.status === 'fulfilled' ? { status: row.status } : { status: row.status, error: diagnosis(row.reason) },
  );
  const first = observed[0]!;
  const second = observed[1]!;
  results.flags = flags;
  if (second.status === 'fulfilled') results.points = second.value;
  let report: unknown;
  try {
    report = await readDeliveryJson(join(f.home, 'data/agent/journal/telemetry-report.json'));
    await writeFile(join(output, 'component-private.json'), JSON.stringify(report, null, 2), {
      flag: 'wx',
      mode: 0o600,
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  try {
    results.startup = await readDeliveryJson(join(f.home, 'data/agent/journal/telemetry-startup.json'));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  assert(first.status === 'fulfilled' && second.status === 'fulfilled', 'Native benchmark or observer failed');
  phase = 'evidence';
  assert(report, 'Complete component report required');
  assert.equal(record(report).installationId, installation);
  const checked = comparison(report, second.value);
  results.comparison = checked;
  results.target = await oracle.counts();
  status = checked.targetMet ? 'passed' : 'target-missed';
  if (!checked.targetMet) process.exitCode = 1;
} catch (error) {
  process.exitCode = 1;
  results.parentFailure = diagnosis(error);
  await writeFile(join(output, 'failure-private.txt'), diagnosis(error), { flag: 'wx', mode: 0o600 });
} finally {
  if (agentId) {
    try {
      const logs = f.logs(agentId);
      results.agentLogs = logs.slice(-16384);
    } catch {
      results.agentLogsUnavailable = true;
    }
  }
  let cleanupVerified = false;
  try {
    await cleanup(f, installation);
    if (installation) cleanupLiveVolumes({ id: installation, user: '1000:1000', docker: f.docker });
    built?.cleanup();
    cleanupVerified = true;
  } catch {
    status = 'failed';
    process.exitCode = 1;
  }
  await writeFile(
    join(output, 'outcome-private.json'),
    JSON.stringify(
      {
        status,
        phase,
        cleanupVerified,
        sourceRevision: f.revision,
        architecture: f.architecture,
        baseImageIds: f.imageIds,
        harnessNode: process.version,
        harnessUid: process.getuid?.() ?? null,
        harnessPlatform: process.platform,
        environment: f.environment,
        results,
      },
      null,
      2,
    ),
    { flag: 'wx', mode: 0o600 },
  );
  console.log(JSON.stringify({ status, phase, cleanupVerified }));
}
