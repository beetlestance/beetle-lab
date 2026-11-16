import {expect, it} from 'vitest';
import {publicShortOutcome} from './outcome.js';
import {percentile} from './measure.js';
const revision = 'a'.repeat(40); const canary = 'PRIVATE-CREDENTIAL-DO-NOT-PUBLISH';
function fixture() {
  const peers = ['frontend', 'backend', 'agent'].map(role => ({role, id: canary, samples: 3, elapsedMs: 1000,
    first: {at: 1, cpuNanos: 0}, last: {at: 1001, cpuNanos: 100000000}, cpuOneCorePercent: 10, peakMemoryBytes: 1024, anonymousBytes: 512}));
  const read = (endpoint: string, ok = true) => ({endpoint, durationMs: ok ? 20 : 5, outcome: ok ? 'ok' : 'protocol', status: ok ? 200 : 503,
    protocolCode: ok ? null : 'capacity_unavailable', secret: canary});
  const calls = [read('run'), ...Array.from({length: 6}, () => read('live')), ...Array.from({length: 3}, () => read('live', false))];
  return {status: 'passed', phase: 'post-idle', cleanupVerified: true, sourceRevision: revision, architecture: 'amd64', harnessNode: 'v24.22.3',
    private: canary, environment: {cpus: 4, memoryBytes: 16106127360, dockerVersion: '28.0.4', kernelVersion: '7.0.0-1017-azure', cgroupVersion: '2', private: canary}, imageSizes: ['frontend', 'backend', 'agent', 'installer', 'engine', 'export'].map(role => ({role, bytes: 16777216, private: canary})), imageIds: Object.fromEntries(['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'].map(role => [role, 'sha256:' + 'b'.repeat(64)])),
    results: {targetRequests: {ready: 1, work: 40, unexpected: 0}, controlReserve: {cpuMillis: 1350, memoryBytes: 603979776, pids: 160},
      idle: {peers, apiCalls: 1, apiP95Ms: 20, readFailures: 0}, idlePartial: {calls: [read('settings')], readFailures: 0},
      loaded: {peers, apiCalls: calls.length, apiP95Ms: 20, readFailures: 0, elapsedMs: 10000, readers: Array.from({length: 3}, () => ({frames: 2, unavailable: 1}))},
      loadedPartial: {calls, readFailures: 0}, postIdle: {peers, apiCalls: 1, apiP95Ms: 20, readFailures: 0},
      postIdlePartial: {calls: [read('settings')], readFailures: 0}}};
}
it('projects closed scoped facts without raw paths, process IDs, request data or credentials', () => {
  const result = publicShortOutcome(fixture(), revision); expect(result.scope).toBe('short-control-window'); expect(result.status).toBe('passed');
  expect(JSON.stringify(result)).not.toContain(canary); expect(result.windows[1]!.latency.endpoints.find(row => row.endpoint === 'live')).toMatchObject({successful: 6, unavailable: 3});
});
it('cannot promote failed cleanup, another runtime/source, missing work or an unobserved reader', () => {
  for (const patch of [{status: 'failed'}, {cleanupVerified: false}, {harnessNode: 'v26.7.0'}, {sourceRevision: 'c'.repeat(40)}])
    expect(() => publicShortOutcome({...fixture(), ...patch}, revision)).toThrow();
  const missing = fixture(); missing.results.targetRequests.work = 39; expect(() => publicShortOutcome(missing, revision)).toThrow();
  const reader = fixture(); reader.results.loaded.readers[0]!.frames = 0; expect(() => publicShortOutcome(reader, revision)).toThrow();
});
it('rejects forged CPU spans, oversized memory, missing request classes and mismatched unavailable counts', () => {
  const cpu = fixture(); cpu.results.loaded.peers[0]!.cpuOneCorePercent = 11; expect(() => publicShortOutcome(cpu, revision)).toThrow();
  const memory = fixture(); memory.results.loaded.peers[0]!.peakMemoryBytes = 67108865; expect(() => publicShortOutcome(memory, revision)).toThrow();
  const counts = fixture(); counts.results.loaded.readers[0]!.unavailable = 0; expect(() => publicShortOutcome(counts, revision)).toThrow();
  const classes = fixture(); classes.results.idlePartial.calls[0]!.endpoint = 'live'; expect(() => publicShortOutcome(classes, revision)).toThrow();
});
it('requires successful live latency too and refuses auth failures masquerading as overload', () => {
  const slow = fixture(); slow.results.loadedPartial.calls[1]!.durationMs = 251;
  slow.results.loadedPartial.calls.push(...Array.from({length: 37}, () => ({...slow.results.loadedPartial.calls.at(-1)!})));
  slow.results.loaded.apiCalls = slow.results.loadedPartial.calls.length;
  slow.results.loaded.readers.forEach((row, index) => {row.unavailable = index === 0 ? 14 : 13;});
  expect(percentile(slow.results.loadedPartial.calls.map(row => row.durationMs), 0.95)).toBe(20); expect(() => publicShortOutcome(slow, revision)).toThrow();
  const auth = fixture(); auth.results.loadedPartial.calls.at(-1)!.protocolCode = 'forbidden'; expect(() => publicShortOutcome(auth, revision)).toThrow();
  const late = fixture(); late.results.loaded.elapsedMs = 90001; expect(() => publicShortOutcome(late, revision)).toThrow();
});
