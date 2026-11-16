import {decodeK6Diagnostics, K6_DIAGNOSTIC_BYTES} from '@beetle/contracts/k6-diagnostics';
/** Explicit task-owned public API -> real agent -> pinned k6 warning qualification. */
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { deriveInstalledIdentity } from '@beetle/contracts';
import { runArtifactContentPath } from '@beetle/contracts/api';
import { decodeK6Warnings } from '@beetle/contracts/k6-warnings';
import { createK6ConfigSchema } from '@beetle/contracts/engine-config/k6';
import { Docker } from '../../../agent/test/container/docker.js';
import { fixture, digest } from '../../../agent/test/container/fixture.js';
import { openApplication } from '../../../app/src/bootstrap/api.js';
import type { Application } from '../../../app/src/bootstrap/api.js';
import { argumentsFor, backendConfiguration } from './configuration.js';
import { provision, captureLogs, targetCounts } from './containers.js';
import { enqueue, finished, ownedOrigin, publicClient, value, waitForCapacity } from './public-api.js';
import { inspectClosed } from './evidence.js';
import { cleanupLiveVolumes } from './live-volumes.js';
const args = argumentsFor(process.argv.slice(2));
assert.equal(args.status, 200);
const f = await fixture(new Docker(args.context, 2), args.agentImage, args.engineImage, 200);
f.offer.config.loadPlan = {version: 1, scenarios: [{id: 'arrival', name: 'bounded_warnings', executor: 'constant-arrival-rate',
  rate: 20, timeUnit: '1s', duration: '2s', preAllocatedVUs: 1, maxVUs: 1, startTime: '0s', gracefulStop: '1s'}], slos: []};
f.offer.config.selections = [{scenarioId: 'arrival', entries: [{requestId: 'get', weight: 1, wait: {durationMs: 500, jitterMs: 0}}]}];
assert(createK6ConfigSchema(digest).validate(f.offer.config));
f.offer.installedIdentity = deriveInstalledIdentity({manifest: f.manifest, profile: f.profile,
  identity: {manifestId: 'k6-native', profileId: 'native', catalogVersion: 1, schemaDigest: createK6ConfigSchema(digest).schemaDigest}}, digest);
const evidence: Record<string, unknown> = {status: 'running', architecture: f.architecture,
  agentImage: f.agentImage.Id, engineImage: f.engineImage.Id, nodeVersion: process.version, platform: process.platform,
  cleanupVerified: false, limits: {vus: 1, durationSeconds: 2, requestedIterationsPerSecond: 20, targetRequestCap: 64},
  limitations: ['No browser, Compose, amd64 or release qualification; inventory does not prove delayed unknown creates absent.']};
console.log(JSON.stringify({status: 'started', directory: f.root}));
let app: Application | undefined; const started = Date.now();
try {
  const origin = await ownedOrigin(); const privateOrigin = await provision(f, 64);
  const config = await backendConfiguration(f, privateOrigin, origin);
  app = await openApplication(config.application); await app.server.listen({...config.listen});
  const session = await publicClient(app, origin); await waitForCapacity(app);
  const queued = await enqueue(session.api, f); const observed = await finished(session.api, queued, 200);
  const result = observed.result.result!; const artifacts = result.artifacts.filter(a => a.kind === 'k6-warnings');
  assert.equal(artifacts.length, 1); const a = artifacts[0]!; assert(a.bytes <= 4096 && a.bytes > 0);
  const params = {...observed.params, attemptId: observed.run.activeAttemptId, artifactId: a.artifactId};
  const response = await session.content(runArtifactContentPath(params)); assert.equal(response.status, 200);
  const bytes = await boundedBytes(response); assert.equal(bytes.length, a.bytes); assert.equal(digest(bytes), a.sha256);
  const report = decodeK6Warnings(bytes); assert.equal(report.native.coverage, 'complete'); assert(report.native.insufficientVus > 0);
  assert.deepEqual(report.scope, {organizationId: queued.scope.organizationId, workspaceId: queued.scope.workspaceId, attemptId: observed.run.activeAttemptId, generation: 1});
  assert.deepEqual(report.configuration.arrival, {executor: 'constant-arrival-rate', peakIterationsPerSecond: 20, preAllocatedVUs: 1, maxVUs: 1});
  assert(report.iteration && report.iteration.count > 0); assert(report.iteration.estimate >= 400);
  evidence.warningArtifact = a; evidence.warningReport = report; evidence.run = observed.run;
  const diagnostics = result.artifacts.filter(item => item.kind === 'k6-diagnostics'); assert.equal(diagnostics.length, 1);
  const diagnostic = diagnostics[0]!; assert(diagnostic.bytes > 0 && diagnostic.bytes <= K6_DIAGNOSTIC_BYTES);
  const diagnosticPath = runArtifactContentPath({...params, artifactId: diagnostic.artifactId});
  const diagnosticResponse = await session.content(diagnosticPath); assert.equal(diagnosticResponse.status, 200);
  const diagnosticBytes = await boundedBytes(diagnosticResponse, K6_DIAGNOSTIC_BYTES);
  assert.equal(diagnosticBytes.length, diagnostic.bytes); assert.equal(digest(diagnosticBytes), diagnostic.sha256);
  const diagnosticReport = decodeK6Diagnostics(diagnosticBytes); assert.deepEqual(diagnosticReport.scope, report.scope);
  assert.equal(diagnosticReport.coverage, 'complete');
  assert(diagnosticReport.records.some(record => record.code === 'insufficient-vus' && record.level === 'warning'));
  evidence.diagnosticArtifact = diagnostic; evidence.diagnosticReport = diagnosticReport;

  await app.close(); app = undefined; evidence.physical = await inspectClosed(f, observed.run, observed.result);
  app = await openApplication(config.application); await app.server.listen({...config.listen});
  const reopened = await publicClient(app, origin); assert.deepEqual(value(await reopened.api.getRunResult({params: observed.params})), observed.result);
  const again = await reopened.content(runArtifactContentPath(params)); assert.equal(again.status, 200);
  assert.equal(digest(await boundedBytes(again)), a.sha256); evidence.reopened = true;
  const diagnosticAgain = await reopened.content(diagnosticPath); assert.equal(diagnosticAgain.status, 200);
  assert.equal(digest(await boundedBytes(diagnosticAgain, K6_DIAGNOSTIC_BYTES)), diagnostic.sha256);

  await app.close(); app = undefined;
  evidence.targetCounts = targetCounts(f, {ready: 1, work: report.iteration.count, unexpected: 0});
  evidence.status = 'passed';
} catch (error) {
  evidence.status = 'failed'; evidence.failure = error instanceof Error ? `${error.name}: ${error.message}`.slice(0, 1024) : 'Unknown failure'; process.exitCode = 1;
} finally {
  if (app) {try {await app.close();} catch {evidence.status = 'failed'; process.exitCode = 1;}}
  try {evidence.diagnostics = await captureLogs(f);} catch {evidence.diagnostics = ['inventory'];}
  try {f.docker.cleanup(f.id); cleanupLiveVolumes(f); evidence.cleanupVerified = true;}
  catch {evidence.status = 'failed'; process.exitCode = 1;}
  evidence.elapsedMs = Date.now() - started;
  await writeFile(join(f.root, 'warning-evidence.json'), JSON.stringify(evidence, null, 2), {mode: 0o600});
  console.log(JSON.stringify({status: evidence.status, directory: f.root, cleanupVerified: evidence.cleanupVerified, failure: evidence.failure}));
}

async function boundedBytes(response: Response, maximum = 4096): Promise<Uint8Array> {
  assert(response.body); const reader = response.body.getReader(); const bytes = new Uint8Array(maximum); let size = 0;
  try {
    for (let calls = 0; calls < 32; calls++) {
      const part = await reader.read(); if (part.done) return bytes.subarray(0, size);
      assert(size + part.value.length <= bytes.length); bytes.set(part.value, size); size += part.value.length;
    }
    throw new Error('Warning body fragment limit');
  } finally { await reader.cancel(); reader.releaseLock(); }
}
