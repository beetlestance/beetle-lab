/** Manual owned-loopback native compatibility check; no container/resource qualification. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { buildRuntimeScript } from '../../build/index.js';
import { compiled, dependencies } from '../suite/fixtures.js';
import { configFor } from '../runtime/fixtures.js';
import { ProcessActor } from '../../wrapper/process/actor.js';
import { nodeSpawn, ownedGroup } from '../../wrapper/process/ports.js';
import { validateProfile } from '../../wrapper/process/profile.js';
import { MetricStream, MetricAccumulator, createK6MetricProfile } from '../../aggregation/index.js';
import { readK6Summary } from '../../wrapper/collection/index.js';
import { recordResult } from './smoke-result.js';

const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error('Provide the installed absolute native k6 binary');
const version = execFileSync(binary, ['version'], { encoding: 'utf8', timeout: 5000,
  maxBuffer: 4096, env: { K6_NO_USAGE_REPORT: 'true' } }).trim();
assert.match(version, /^k6 v2\.2\.0\b/);
for (const workloadStatus of [200, 500]) {
  const directory = await mkdtemp('/private/tmp/beetle-native-phase-');
  const counts = { ready: 0, work: 0 };
  const server = createServer((request, response) => {
    if (request.url === '/ready') {
      counts.ready++;
      setTimeout(() => { response.writeHead(200); response.end('ready'); }, 100);
    } else if (request.url === '/work') {
      counts.work++; response.writeHead(workloadStatus); response.end('ok');
    } else { response.writeHead(404); response.end(); }
  });
  await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  const address = server.address(); assert(address && typeof address !== 'string');
  let actor: ProcessActor | undefined;
  const cancel = new AbortController();
  const timer = setTimeout(() => cancel.abort(), 15_000);
  try {
    const config = configFor();
    config.target = `http://127.0.0.1:${address.port}`;
    config.secrets = []; config.datasets = [];
    config.requests[0] = { id: 'get', name: 'owned', method: 'GET', path: '/work', query: {}, headers: {},
      assertions: [{ id: 'ok', kind: 'statusEq', required: true, value: 200 }] };
    config.selections[0]!.entries = [{ requestId: 'get', weight: 1, maxIterationsPerVu: 1, wait: { durationMs: 0, jitterMs: 0 } }];
    config.readiness = { path: '/ready', attempts: 1, intervalMs: 0, timeoutMs: 1000, wallBudgetMs: 1000,
      expectedStatus: 200, assertions: [] };
    config.loadPlan.scenarios = [{ id: 'main', name: 'main', executor: 'per-vu-iterations', startTime: '0s',
      gracefulStop: '0s', vus: 1, iterations: 1, maxDuration: '2s' }];
    const pins = dependencies(); pins.engine.version = '2.2.0';
    const suite = compiled(config, pins);
    const attempt = { mode: 'managed' as const, timeoutMs: 10_000, deadlineMs: Date.now() + 10_000 };
    const build = await buildRuntimeScript({ suite, outputDirectory: directory, attempt, maximumBuildBytes: 2_097_152 });
    const emptyConfig = join(directory, 'empty-config.json');
    await writeFile(emptyConfig, '{}\n', { mode: 0o600, flag: 'wx' });
    const profile = createK6MetricProfile(suite);
    const accumulator = new MetricAccumulator({ profile, window: async () => {} });
    const decoder = new MetricStream({ ...profile, maximumBytes: 1_048_576, maximumRecords: 10_000,
      point: (point, signal) => accumulator.point(point, signal) });
    // Private compatibility seam only: product entrypoint deliberately permits Linux alone.
    actor = new ProcessActor({ binary: await realpath(binary), emptyConfig, directory,
      script: build.scriptPath, attempt, maxMetricStreamBytes: 1_048_576, maxDiagnosticBytes: 65_536,
      drainTimeoutMs: 1000, signal: cancel.signal, sink: (bytes, delivery) => decoder.push(bytes, delivery.signal) },
    { spawn: nodeSpawn, group: ownedGroup, validate: validateProfile });
    const observation = await actor.run();
    const terminalObservedAt = new Date().toISOString();
    console.log(JSON.stringify({ directory, version, counts, observation }));
    assert.equal(observation.exitCode, workloadStatus === 200 ? 0 : 99); assert.equal(observation.collection, 'complete');
    const stream = decoder.finish();
    const snapshot = await accumulator.finish(cancel.signal);
    assert.deepEqual(snapshot.windowCoverage, { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 });
    const collection = readK6Summary({ compiledSuite: suite, outputDirectory: directory, uid: process.getuid!(),
      process: observation, deadlineMs: attempt.deadlineMs, timeoutMs: 2000 });
    const summary = await collection.result; await collection.quiesced;
    assert(summary.ok, JSON.stringify(summary));
    assert.deepEqual(counts, { ready: 1, work: 1 });
    assert.equal(summary.evidence.metrics.http_reqs!.values.count, 1);
    assert.equal(summary.evidence.metrics.http_req_duration!.values.count, 1);
    assert.equal(summary.evidence.metrics.beetle_measure_started!.values.count, 1);
    assert.equal(summary.evidence.metrics['beetle_requests{request:r0}']!.values.count, 1);
    assert.equal(summary.evidence.metrics.beetle_required_failures!.values.count, workloadStatus === 200 ? 0 : 1);
    assert(snapshot.totals.every(item => item.scope !== 'prepare'));
    assert.equal(snapshot.totals.filter(item => item.metric === 'http_reqs').reduce((sum, item) => sum + (item.total.kind === 'counter' ? item.total.sum : 0), 0), 1);
    const duration = summary.evidence.timing.testRunDurationMs;
    assert(duration !== null && duration > 0);
    assert(Math.abs(summary.evidence.metrics.http_reqs!.values.rate! - 1000 / duration) < 1e-9);
    await actor.close(); await decoder.close(); await accumulator.close(); await collection.close();
    const result = await recordResult({ directory, deadlineMs: attempt.deadlineMs, signal: cancel.signal,
      expected: workloadStatus === 200 ? 'passed' : 'failed', evidence: { suite, process: observation,
        terminalObservedAt, summary: summary.evidence, metrics: snapshot, artifacts: [],
        orchestrationFailure: null, orchestrationQuiescent: true, scope: { organizationId: randomUUID(),
          workspaceId: randomUUID(), attemptId: randomUUID(), generation: 1 } } });
    console.log(JSON.stringify({ stream, measurement: snapshot.measurement, coverage: snapshot.windowCoverage,
      timing: summary.evidence.timing, requests: summary.evidence.metrics.http_reqs, result }));
  } finally {
    clearTimeout(timer); cancel.abort(); await actor?.close();
    await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  }
}
