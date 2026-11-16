import {expect, it} from 'vitest';
import {publicCase} from './outcome.js';
import {publicFailure} from './failure.js';
import {sourceCases} from './cases.js';
const revision = 'a'.repeat(40); const canary = 'PRIVATE-CANARY';
function base() {return {revision, architecture: 'amd64', harnessNode: 'v24.22.3', status: 'passed', phase: 'discovery-reached', cleanupVerified: true,
 private: canary, imageIds: Object.fromEntries(['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'].map(role => [role, 'sha256:' + 'b'.repeat(64)]))};}
function terminal(outcome = 'passed') {return {state: 'finished', outcome, reason: null, scope: canary};}
function fixture() {return {...base(), results: ['executors', 'discovery-reached'].map((kind, index) => ({kind, run: terminal(),
 result: {outcome: 'passed', execution: {status: 'completed', exitCode: index ? 99 : 0}, private: canary}}))};}
it('projects closed native outcomes and strips nested arbitrary private fields', () => {
 const result = publicCase(fixture(), 'engine-executors', revision); expect(result.status).toBe('passed');
 expect(JSON.stringify(result)).not.toContain(canary);
});
it('rejects failed, incomplete, wrong-platform/source and wrong native exit evidence', () => {
 for (const patch of [{status: 'failed'}, {cleanupVerified: false}, {architecture: 'arm64'}, {revision: 'c'.repeat(40)}, {harnessNode: 'v26.0.0'}, {phase: 'startup'}])
  expect(() => publicCase({...fixture(), ...patch}, 'engine-executors', revision)).toThrow();
 const wrong = fixture(); wrong.results[1]!.result.execution.exitCode = 0;
 expect(() => publicCase(wrong, 'engine-executors', revision)).toThrow();
 expect(() => publicCase({...fixture(), results: []}, 'engine-executors', revision)).toThrow();
});
function longFixture() {
 const peers = ['frontend', 'backend', 'agent'].map(role => ({role, samples: 120, elapsedMs: 1830000, peakMemoryBytes: 1000000, cpuOneCorePercent: 2, first: {at: 0, cpuNanos: 0}, last: {at: 1830000, cpuNanos: 36600000000}, id: canary}));
 return {...base(), sourceRevision: revision, phase: 'post-idle', results: {
 targetRequests: {ready: 1, work: 1830, unexpected: 0},
 stream: {run: terminal(), activeMs: 1830000, peers,
 readers: [0, 1, 2].map(() => ({frames: 800, polls: 900, unavailable: 30, firstFrameMs: 1000, lastFrameMs: 1800000,
 longestNewFrameGapMs: 8000, tailWithoutNewFrameMs: 1000, lastSnapshot: canary})),
 latency: ['run', 'live'].map(endpoint => ({endpoint, attempted: 900, successful: 870, unavailable: 30, allP95Ms: 20, successfulP95Ms: 20}))},
 postIdle: {peers: peers.map(row => ({...row, samples: 3, elapsedMs: 8000, last: {at: 8000, cpuNanos: 160000000}}))},
 final: {terminalLiveUnavailable: true, artifacts: ['k6-diagnostics', 'k6-warnings', 'metric-index', 'metric-windows', 'metrics-csv', 'native-summary', 'numeric-final', 'performance-report']
 .map(kind => ({kind, bytes: 100, sha256: 'c'.repeat(64), private: canary}))}}};
}
it('keeps long active/fresh/artifact and post-idle facts without snapshots', () => {
 const result = publicCase(longFixture(), 'long-stream', revision); expect(JSON.stringify(result)).not.toContain(canary);
});
it('cannot accept short fresh coverage, absent artifacts or missing post-idle samples', () => {
 const short = longFixture(); short.results.stream.readers[1]!.lastFrameMs = 50000;
 expect(() => publicCase(short, 'long-stream', revision)).toThrow();
 const missing = longFixture(); missing.results.final.artifacts.pop(); expect(() => publicCase(missing, 'long-stream', revision)).toThrow();
 const duplicate = longFixture(); duplicate.results.final.artifacts[0]!.kind = 'metric-index'; expect(() => publicCase(duplicate, 'long-stream', revision)).toThrow();
 const post = longFixture(); post.results.postIdle.peers = []; expect(() => publicCase(post, 'long-stream', revision)).toThrow();
});
it('declares exactly six finite cases or one36-minute stream and rejects unknown profiles', () => {
 expect(sourceCases('conformance')).toHaveLength(6); expect(sourceCases('long-stream')[0]!.timeoutMs).toBe(2160000);
 expect(() => sourceCases('anything')).toThrow();
});
it('rejects unobserved placeholders and inconsistent CPU facts', () => {
 const zero = longFixture(); zero.results.stream.peers[0]!.samples = 0;
 expect(() => publicCase(zero, 'long-stream', revision)).toThrow();
 const wrong = longFixture(); wrong.results.stream.peers[0]!.cpuOneCorePercent = 3;
 expect(() => publicCase(wrong, 'long-stream', revision)).toThrow();
});
it('retains only known failure phases, never arbitrary exception text or partial success', () => {
 const failed = {...base(), status: 'failed', phase: 'advanced-provision', results: {}, error: canary};
 expect(publicFailure(failed, 'long-stream', revision)).toMatchObject({status: 'failed', phase: 'advanced-provision', evidenceAvailable: true});
 expect(JSON.stringify(publicFailure({...failed, phase: canary}, 'long-stream', revision))).not.toContain(canary);
 expect(publicFailure({...failed, architecture: 'arm64'}, 'long-stream', revision).evidenceAvailable).toBe(false);
 expect(publicFailure(undefined, 'long-stream', revision).evidenceAvailable).toBe(false);
});
