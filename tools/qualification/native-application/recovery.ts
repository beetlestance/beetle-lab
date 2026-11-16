import assert from 'node:assert/strict';
import { randomUUID, createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import type { Fixture } from '../../../agent/test/container/fixture.js';
import { UnixDockerTransport } from '../../../agent/src/backends/docker/index.js';
import { openBackendServing } from '../../../app/src/bootstrap/recovery-control/index.js';
import { coldBackup } from '../../recovery/src/backup.js';
import { sourceLayout } from '../../recovery/src/layout.js';
import { restoreHistory } from '../../recovery/src/restore.js';
import { openHistoryViewer } from '../../recovery/src/viewer/index.js';
import { automaticSession, readContent, hash } from './compose/public.js';
import { ownedOrigin, value } from './public-api.js';
const digest = async (path: string) => createHash('sha256').update(await readFile(path)).digest('hex');
/** Task-owned stopped agent only; no serving/root authority is reused by history. */
export async function coldRecovery(f: Fixture, run: Run, context: string) {
  const archive = f.root + '-archive'; const history = f.root + '-history';
  const limits = {maximumBytes: 134217728, maximumEntries: 2000};
  const operation = () => ({signal: new AbortController().signal, deadline: performance.now() + 60000});
  const workers = {agentWorkerUrl: pathToFileURL(resolve(process.env.BEETLE_AGENT_WORKER_FILE ?? 'agent/dist/worker.js')),
    metadataWorkerUrl: pathToFileURL(resolve(process.env.BEETLE_METADATA_WORKER_FILE ?? 'app/dist/worker.js'))};
  f.docker.run(['stop', '--time', '30', f.agent]);
  const endpoint = f.docker.run(['context','inspect',context,'--format','{{.Endpoints.docker.Host}}']); assert(endpoint.startsWith('unix://'));
  const copied = await coldBackup({layout: sourceLayout(f.root, {installation: 'backend/installation.json', backendConnection: 'backend/agent.json'}),
    destination: archive, limits, operation: operation()}, {...workers, docker: new UnixDockerTransport(endpoint.slice(7))});
  const restored = await restoreHistory({archive, destination: history, operationId: randomUUID(), limits, operation: operation()});
  assert.throws(() => openBackendServing(join(history, 'history-control.sqlite'), restored.historyId));
  const verified = await readHistoricalRecovery(history, run, limits, workers.metadataWorkerUrl);
  assert.deepEqual(await restoreHistory({archive, destination: history, operationId: restored.operationId, resume: true, limits, operation: operation()}), restored);
  return {backup: copied, historyId: restored.historyId, ...verified,
    metadataUnchanged: true, servingRefused: true, mutationsRefused: true, completedResumeUnchanged: true};
}

export async function readHistoricalRecovery(history: string, run: Run, limits: {maximumBytes: number; maximumEntries: number}, metadataWorkerUrl: URL) {
  const metadataPath = join(history, 'data/metadata.sqlite'); const before = await digest(metadataPath);
  const origin = await ownedOrigin(); const viewer = await openHistoryViewer({root: history, externalOrigin: origin,
    metadataWorkerUrl, limits, operation: {signal: new AbortController().signal, deadline: performance.now() + 60000}});
  let verified: Awaited<ReturnType<typeof verifyHistoricalClient>>;
  try {
    await viewer.server.listen({host: '127.0.0.1', port: Number(new URL(origin).port)});
    const client = await automaticSession(origin); assert.equal(client.session.readOnly, true);
    verified = await verifyHistoricalClient(client, run);
    assert.equal(viewer.runtimeState(), 'disabled'); assert.equal(viewer.historySummaryState(), 'disabled'); assert.equal(viewer.inputRecoveryState(), 'disabled');
  } finally {await viewer.close();}
  assert.equal(await digest(metadataPath), before);
  return {...verified, metadataUnchanged: true, mutationsRefused: true};
}

export async function verifyHistoricalClient(client: Awaited<ReturnType<typeof automaticSession>>, run: Run) {
  let bytes = 0; let artifacts = 0;
    const params = {organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId, runId: run.id};
    assert.deepEqual(value(await client.api.getRun({params})), run);
    assert.equal(value(await client.api.getRunResult({params})).activeAttemptId, run.activeAttemptId);
    const listed = value(await client.api.listRunArtifacts({params: {...params, attemptId: run.activeAttemptId}, query: {limit: 100}}));
    assert.equal(listed.availability, 'ready'); assert(listed.items.length > 0 && listed.nextCursor === null);
    for (const item of listed.items) {
      assert(item.bytes <= 4194304);
      const content = await readContent(await client.content(runArtifactContentPath({...params, attemptId: run.activeAttemptId, artifactId: item.artifactId})), 4194304);
      assert.equal(content.length, item.bytes); assert.equal(hash(content), item.sha256); bytes += content.length; artifacts++;
    }
    const denied = await client.api.createOrganization({body: {scope: {kind: 'installation'}, name: 'Must refuse', slug: 'must-refuse', requestId: randomUUID()}});
    assert(!denied.ok && denied.error.status === 403);
  return {downloadedArtifacts: artifacts, downloadedBytes: bytes};
}
