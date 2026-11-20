import assert from 'node:assert/strict';
import type { Run } from '@beetle/contracts/api';
import type { Fixture } from '../compose/fixture.js';
import { ownedOrigin, pause, value } from '../public-api.js';
import { automaticSession } from '../compose/public.js';
import { verifyHistoricalClient } from '../recovery.js';
type ArchivedArtifact = { artifactId: string; kind: string; bytes: number; sha256: string };
export type ViewerCheck = (
  origin: string,
  run: Run,
  artifacts: readonly ArchivedArtifact[],
  peer: Run | undefined,
) => Promise<unknown>;

export async function historicalViewer(
  f: Fixture,
  owner: string,
  history: string,
  { run, artifacts, peer }: { run: Run; artifacts: readonly ArchivedArtifact[]; peer?: Run | undefined },
  inspect?: ViewerCheck,
) {
  const network = `beetle-cold-${owner}`;
  const ingress = `beetle-cold-ingress-${owner}`;
  const backend = `beetle-cold-backend-${owner}`;
  const ui = `beetle-cold-ui-${owner}`;
  const origin = await ownedOrigin();
  const port = new URL(origin).port;
  const common = [
    '--pull',
    'never',
    '--label',
    `dev.beetle.qualification=${owner}`,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory-swap',
    '256m',
    '--user',
    '1000:1000',
  ];
  f.docker.run(['network', 'create', '--internal', '--label', `dev.beetle.qualification=${owner}`, network]);
  f.docker.run(['network', 'create', '--label', `dev.beetle.qualification=${owner}`, ingress]);
  const liveOrigin = inspect ? f.origin : undefined;
  startHistoryBackend(f, { common, backend, network, history, origin, liveOrigin });
  startHistoryUi(f, { ui, owner, ingress, port });
  f.docker.run(['network', 'connect', network, ui]);
  const client = await automaticSession(origin);
  assert.equal(client.session.readOnly, true);
  assert.equal(client.session.liveOrigin, liveOrigin);
  const reads = await verifyHistoricalClient(client, run);
  const listed = value(
    await client.api.listRunArtifacts({
      params: {
        organizationId: run.scope.organizationId,
        workspaceId: run.scope.workspaceId,
        runId: run.id,
        attemptId: run.activeAttemptId,
      },
      query: { limit: 100 },
    }),
  );
  assert.equal(listed.availability, 'ready');
  assert.equal(listed.nextCursor, null);
  const descriptors = listed.items.map(({ artifactId, kind, bytes, sha256 }) => ({ artifactId, kind, bytes, sha256 }));
  assert.deepEqual(descriptors, artifacts);
  if (peer) await compareArchive(client, run, peer);
  const browser = await inspect?.(origin, run, descriptors, peer);
  f.docker.run(['restart', '--time', '30', backend]);
  let persisted = false;
  for (let n = 0; n < 80; n++) {
    const result = await client.api.getBrowserSession();
    if (result.ok) {
      assert.deepEqual(result.value, client.session);
      persisted = true;
      break;
    }
    await pause();
  }
  assert(persisted);
  f.docker.run(['stop', '--time', '30', backend]);
  return { ...reads, mutationsRefused: true, sessionPersisted: true, ...(browser !== undefined ? { browser } : {}) };
}

async function compareArchive(client: Awaited<ReturnType<typeof automaticSession>>, run: Run, peer: Run) {
  const { organizationId, workspaceId } = run.scope;
  const runIds = [run.id, peer.id];
  const compared = value(
    await client.api.compareRuns({
      params: { organizationId, workspaceId },
      body: { scope: run.scope, runIds, metric: null },
    }),
  );
  assert.equal(compared.baselineRunId, run.id);
  assert.deepEqual(
    compared.items.map((item) => item.run.id),
    runIds,
  );
}

function startHistoryBackend(
  f: Fixture,
  {
    common,
    backend,
    network,
    history,
    origin,
    liveOrigin,
  }: {
    common: string[];
    backend: string;
    network: string;
    history: string;
    origin: string;
    liveOrigin: string | undefined;
  },
): void {
  f.docker.run([
    'run',
    '-d',
    ...common,
    '--name',
    backend,
    '--network',
    network,
    '--network-alias',
    'backend',
    '--memory',
    '256m',
    '--cpus',
    '0.5',
    '--pids-limit',
    '64',
    '--mount',
    `type=bind,source=${history},target=${history}`,
    '-e',
    `BEETLE_HISTORY_ROOT=${history}`,
    '-e',
    `BEETLE_HISTORY_EXTERNAL_ORIGIN=${origin}`,
    ...(liveOrigin ? ['-e', `BEETLE_HISTORY_LIVE_ORIGIN=${liveOrigin}`] : []),
    '-e',
    'BEETLE_HISTORY_MAXIMUM_BYTES=134217728',
    '--entrypoint',
    'node',
    f.images.installer!,
    '/beetle/install/history.js',
  ]);
}

function startHistoryUi(
  f: Fixture,
  { ui, owner, ingress, port }: { ui: string; owner: string; ingress: string; port: string },
): void {
  f.docker.run([
    'run',
    '-d',
    '--name',
    ui,
    '--pull',
    'never',
    '--label',
    `dev.beetle.qualification=${owner}`,
    '--network',
    ingress,
    '--publish',
    `127.0.0.1:${port}:8080`,
    '--read-only',
    '--cap-drop',
    'ALL',
    '--security-opt',
    'no-new-privileges:true',
    '--memory',
    '64m',
    '--memory-swap',
    '64m',
    '--cpus',
    '0.1',
    '--pids-limit',
    '32',
    '--tmpfs',
    '/tmp:rw,noexec,nosuid,nodev,size=16777216',
    f.images.frontend!,
  ]);
}
