import { tmpdir } from 'node:os';
/** Manual owned-loopback native compatibility check; no container/resource qualification. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdtemp, writeFile, realpath } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import { compiled, dependencies } from '../suite/fixtures.js';
import { configFor } from '../runtime/fixtures.js';
import { ProcessActor } from '../../wrapper/process/actor.js';
import { nodeSpawn, ownedGroup } from '../../wrapper/process/ports.js';
import { validateProfile } from '../../wrapper/process/profile.js';
import { Execution } from '../../wrapper/execution/operation.js';
import { snapshot as executionProfile } from '../../wrapper/execution/profile.js';
import { productionPorts } from '../../wrapper/execution/ports.js';
import type { ExecutionReceipt } from '../../wrapper/execution/index.js';
import { recordResult } from './smoke-result.js';

const binary = process.argv[2];
if (!binary || !isAbsolute(binary)) throw new Error('Provide the installed absolute native k6 binary');
const version = execFileSync(binary, ['version'], { encoding: 'utf8', timeout: 5000,
  maxBuffer: 4096, env: { K6_NO_USAGE_REPORT: 'true' } }).trim();
assert.match(version, /^k6 v2\.2\.0\b/);
process.umask(0o077);
for (const workloadStatus of [200, 500]) {
  const directory = await mkdtemp(join(await realpath(tmpdir()), 'beetle-native-phase-'));
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
  let execution: Execution | undefined;
  const cancel = new AbortController();
  const timer = setTimeout(() => cancel.abort(), 15_000);
  let failure: { error: unknown } | undefined;
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
    const emptyConfig = join(directory, 'empty-config.json');
    await writeFile(emptyConfig, '{}\n', { mode: 0o600, flag: 'wx' });
    let markerTime: number | null = null; let collectionTime: string | null = null; let windows = 0;
    // Only the native factory uses the private Darwin seam; all coordination is production code.
    execution = new Execution(executionProfile({ compiled: { suite, attempt }, binary: await realpath(binary),
      emptyConfig, outputDirectory: directory, uid: process.getuid!(), signal: cancel.signal,
      limits: { maximumBuildBytes: 2_097_152, reservedOutputBytes: 3_145_728, maximumMetricBytes: 1_048_576,
        maximumMetricRecords: 10_000, maximumDiagnosticBytes: 65_536, drainTimeoutMs: 1000, collectionTimeoutMs: 2000 },
      window: async () => { windows++; }, measureStarted: async receipt => {
        assert.equal(markerTime, null); markerTime = receipt.sourceTimeMs;
      }, collectStarted: async receipt => {
        assert.notEqual(markerTime, null); assert.equal(collectionTime, null);
        assert(Date.parse(receipt.observedAt) >= Date.parse(receipt.terminalObservedAt));
        collectionTime = receipt.terminalObservedAt;
      } }), { ...productionPorts, native: input => new ProcessActor(input,
      { spawn: nodeSpawn, group: ownedGroup, validate: validateProfile }) });
    const first: ExecutionReceipt = await execution.result;
    const final: ExecutionReceipt = await execution.final; await execution.quiesced;
    assert(first.ok, JSON.stringify('code' in first ? first.code : null));
    assert(final.ok, JSON.stringify('code' in final ? final.code : null)); assert.deepEqual(final, first);
    const observation: ExecutionReceipt['process'] = final.process;
    const snapshot: ExecutionReceipt['metrics'] = final.metrics;
    const summary: ExecutionReceipt['summary'] = final.summary;
    const stream: ExecutionReceipt['stream'] = final.stream;
    const terminalObservedAt: ExecutionReceipt['terminalObservedAt'] = final.terminalObservedAt;
    assert(observation && snapshot && summary?.ok && stream && terminalObservedAt);
    assert.equal(collectionTime, terminalObservedAt);
    console.log(JSON.stringify({ directory, version, counts, observation }));
    assert.equal(observation.exitCode, workloadStatus === 200 ? 0 : 99); assert.equal(observation.collection, 'complete');
    assert(windows > 0); assert.equal(markerTime, snapshot.measurement.sourceTimeMs);
    assert.deepEqual(snapshot.windowCoverage, { complete: true, latePoints: 0, markerDelayDroppedBuckets: 0 });
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
    await execution.close();
    const result = await recordResult({ directory, deadlineMs: attempt.deadlineMs, signal: cancel.signal,
      expected: workloadStatus === 200 ? 'passed' : 'failed', evidence: { suite, process: observation,
        terminalObservedAt, summary: summary.evidence, metrics: snapshot, artifacts: [],
        orchestrationFailure: null, orchestrationQuiescent: true, scope: { organizationId: randomUUID(),
          workspaceId: randomUUID(), attemptId: randomUUID(), generation: 1 } } });
    console.log(JSON.stringify({ stream, measurement: snapshot.measurement, coverage: snapshot.windowCoverage,
      timing: summary.evidence.timing, requests: summary.evidence.metrics.http_reqs, result }));
  } catch (error) { failure = { error }; }
  finally {
    clearTimeout(timer); cancel.abort();
    const cleanup = await Promise.allSettled([Promise.resolve().then(() => execution?.close()),
      new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))]);
    const failed = cleanup.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    if (failed.length) failure = { error: new AggregateError([...(failure ? [failure.error] : []),
      ...failed.map(result => result.reason)], 'Owned smoke cleanup failed') };
  }
  if (failure) throw failure.error;
}
