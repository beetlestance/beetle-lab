import assert from 'node:assert/strict';
import { record } from '../../resources/values.js';
import { percentile } from './measure.js';
import { daemonEnvironment } from '../compose/fixture.js';
const roles = ['frontend', 'backend', 'agent'];
const imageRoles = [...roles, 'installer', 'engine', 'offline'];
function integer(input: unknown, maximum: number, minimum = 0): number {
  assert(typeof input === 'number' && Number.isSafeInteger(input) && input >= minimum && input <= maximum);
  return input;
}
function number(input: unknown, maximum: number): number {
  assert(typeof input === 'number' && Number.isFinite(input) && input >= 0 && input <= maximum);
  return input;
}
function peers(input: unknown) {
  assert(Array.isArray(input) && input.length === 3);
  const seen = new Set<string>();
  return input.map((value) => {
    const row = record(value);
    assert(typeof row.role === 'string' && roles.includes(row.role) && !seen.has(row.role));
    seen.add(row.role);
    const first = record(row.first);
    const last = record(row.last);
    const elapsedMs = number(row.elapsedMs, 120000);
    assert(elapsedMs > 0);
    assert(Math.abs(number(last.at, 9007199254740991) - number(first.at, 9007199254740991) - elapsedMs) < 0.001);
    const delta = integer(last.cpuNanos, 9007199254740991) - integer(first.cpuNanos, 9007199254740991);
    assert(delta >= 0);
    const cpuOneCorePercent = number(row.cpuOneCorePercent, 10000);
    assert(Math.abs(cpuOneCorePercent - delta / (elapsedMs * 10000)) < 0.0001);
    const ceiling = row.role === 'frontend' ? 67108864 : 268435456;
    return {
      role: row.role,
      samples: integer(row.samples, 128, 2),
      elapsedMs,
      cpuOneCorePercent,
      peakMemoryBytes: integer(row.peakMemoryBytes, ceiling, 1),
      anonymousBytes: row.anonymousBytes === null ? null : integer(row.anonymousBytes, ceiling),
    };
  });
}
function call(input: unknown) {
  const row = record(input);
  assert(typeof row.endpoint === 'string' && ['settings', 'run', 'live'].includes(row.endpoint));
  const ok = row.outcome === 'ok';
  if (ok) assert.equal(row.status, 200);
  else {
    assert(row.endpoint === 'live' && row.outcome === 'protocol');
    assert(row.status === 429 || row.status === 503);
    assert(typeof row.protocolCode === 'string');
    assert(
      row.status === 429
        ? row.protocolCode === 'rate_limited'
        : ['capacity_unavailable', 'storage_unavailable'].includes(row.protocolCode),
    );
  }
  return { endpoint: row.endpoint, ms: number(row.durationMs, 120000), ok };
}
function latency(kind: string, summary: Record<string, unknown>, partial: unknown) {
  const raw = record(partial);
  assert(Array.isArray(raw.calls) && raw.calls.length > 0 && raw.calls.length <= 512);
  const calls = raw.calls.map(call);
  assert.equal(raw.readFailures, 0);
  assert.equal(summary.apiCalls, calls.length);
  assert.equal(summary.readFailures, 0);
  const allP95Ms = percentile(
    calls.map((call) => call.ms),
    0.95,
  );
  assert(allP95Ms <= 250 && Math.abs(number(summary.apiP95Ms, 120000) - allP95Ms) < 0.001);
  const endpoints = ['settings', 'run', 'live'].flatMap((endpoint) => {
    const rows = calls.filter((call) => call.endpoint === endpoint);
    if (!rows.length) return [];
    const successful = rows.filter((call) => call.ok);
    assert(successful.length > 0);
    const p95Ms = percentile(
      rows.map((call) => call.ms),
      0.95,
    );
    const successfulP95Ms = percentile(
      successful.map((call) => call.ms),
      0.95,
    );
    assert(p95Ms <= 250 && successfulP95Ms <= 250);
    if (endpoint !== 'live') assert.equal(rows.length, successful.length);
    return [
      {
        endpoint,
        attempted: rows.length,
        successful: successful.length,
        unavailable: rows.length - successful.length,
        p95Ms,
        successfulP95Ms,
      },
    ];
  });
  assert.deepEqual(endpoints.map((row) => row.endpoint).sort(), kind === 'loaded' ? ['live', 'run'] : ['settings']);
  return { attempted: calls.length, p95Ms: allP95Ms, endpoints };
}
function imageSizes(input: unknown) {
  assert(Array.isArray(input) && input.length === 6);
  const expected = ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'];
  const rows = input.map((value) => {
    const row = record(value);
    assert(typeof row.role === 'string' && expected.includes(row.role));
    return { role: row.role, bytes: integer(row.bytes, 9007199254740991, 1) };
  });
  assert.equal(new Set(rows.map((row) => row.role)).size, 6);
  return rows;
}
function environment(input: unknown) {
  if (input === undefined) return null;
  const row = record(input);
  return daemonEnvironment({
    NCPU: row.cpus,
    MemTotal: row.memoryBytes,
    ServerVersion: row.dockerVersion,
    KernelVersion: row.kernelVersion,
    CgroupVersion: row.cgroupVersion,
  });
}
export function publicShortOutcome(input: unknown, expectedRevision: string) {
  const source = record(input);
  assert.equal(source.sourceRevision, expectedRevision);
  assert(/^[a-f0-9]{40}$/.test(expectedRevision));
  assert(source.architecture === 'amd64' || source.architecture === 'arm64');
  assert(typeof source.harnessNode === 'string' && /^v24\.[0-9]+\.[0-9]+$/.test(source.harnessNode));
  assert(source.status === 'passed' && source.phase === 'post-idle' && source.cleanupVerified === true);
  const images = record(source.imageIds);
  const imageIds: Record<string, string> = {};
  for (const role of imageRoles) {
    const id = images[role];
    assert(typeof id === 'string' && /^sha256:[a-f0-9]{64}$/.test(id));
    imageIds[role] = id;
  }
  const results = record(source.results);
  assert.deepEqual(results.targetRequests, { ready: 1, work: 40, unexpected: 0 });
  assert.deepEqual(results.controlReserve, { cpuMillis: 2100, memoryBytes: 603979776, pids: 160 });
  const windows = ['idle', 'loaded', 'postIdle'].map((kind) => {
    const row = record(results[kind]);
    return { kind, peers: peers(row.peers), latency: latency(kind, row, results[kind + 'Partial']) };
  });
  const loaded = record(results.loaded);
  assert(number(loaded.elapsedMs, 90000) < 90000);
  assert(Array.isArray(loaded.readers) && loaded.readers.length === 3);
  const readers = loaded.readers.map((value) => {
    const row = record(value);
    return { frames: integer(row.frames, 128, 2), unavailable: integer(row.unavailable, 512) };
  });
  const live = windows.find((row) => row.kind === 'loaded')!.latency.endpoints.find((row) => row.endpoint === 'live')!;
  assert(readers.reduce((sum, row) => sum + row.frames, 0) <= live.successful);
  assert.equal(
    readers.reduce((sum, row) => sum + row.unavailable, 0),
    live.unavailable,
  );
  return {
    format: 'beetle-short-control-observation',
    version: 1,
    scope: 'short-control-window',
    status: 'passed',
    sourceRevision: expectedRevision,
    architecture: source.architecture,
    harnessNode: source.harnessNode,
    imageIds,
    cleanupVerified: true,
    windows,
    readers,
    environment: environment(source.environment),
    dockerReportedVirtualImageBytes: imageSizes(source.imageSizes),
    targetRequests: { ready: 1, work: 40, unexpected: 0 },
    limits: [
      'No uninterrupted-reader or availability SLA',
      'No30-minute, flood, repeated growth or telemetry comparison proof',
      'CPU is descriptive; memory is Docker usage, not process RSS',
      'Virtual image sizes share layers and are not additive disk requirements',
    ],
  };
}
