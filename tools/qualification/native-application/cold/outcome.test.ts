import {expect, it} from 'vitest';
import {publicColdOutcome} from './outcome.js';
import {coldOwner} from './ownership.js';
const canary = 'PRIVATE-CREDENTIAL-DO-NOT-PUBLISH';
function fixture() {
  const artifacts = ['k6-diagnostics', 'k6-warnings', 'metric-index', 'metric-windows', 'metrics-csv', 'native-summary', 'numeric-final', 'performance-report']
    .map(kind => ({kind, artifactId: canary, bytes: 5, sha256: 'b'.repeat(64), private: canary}));
  return {status: 'passed', phase: 'completed-resume', user: '1000:1000', cleanupVerified: true, revision: 'a'.repeat(40), architecture: 'amd64',
    private: canary, imageIds: Object.fromEntries(['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'].map(role => [role, 'sha256:' + 'c'.repeat(64)])),
    results: {seed: {artifacts, requests: {ready: 1, work: 1, unexpected: 0}, config: canary},
      viewer: {downloadedArtifacts: 8, downloadedBytes: 40, mutationsRefused: true, sessionPersisted: true, cookie: canary},
      backup: {files: 13, directories: 7, payloadBytes: 1000, manifestBytes: 100, controlAllowanceBytes: 65536},
      sourceMainFilesUnchanged: true, metadataUnchanged: true, completedResumeUnchanged: true, cleanupFailures: []}};
}
it('projects only closed facts without source paths, credentials, IDs or configs', () => {
  const result = publicColdOutcome(fixture()); expect(result.status).toBe('passed'); expect(JSON.stringify(result)).not.toContain(canary);
});
it('cannot promote failed execution, cleanup, read-only or preservation evidence', () => {
  const original = fixture();
  for (const change of [{status: 'failed'}, {cleanupVerified: false}, {user: '501:20'}, {phase: 'backup'}]) expect(publicColdOutcome({...original, ...change}).status).toBe('failed');
  for (const change of [{metadataUnchanged: false}, {sourceMainFilesUnchanged: false}, {completedResumeUnchanged: false}, {cleanupFailures: ['failed']}])
    expect(publicColdOutcome({...original, results: {...original.results, ...change}}).status).toBe('failed');
  for (const change of [{mutationsRefused: false}, {sessionPersisted: false}])
    expect(publicColdOutcome({...original, results: {...original.results, viewer: {...original.results.viewer, ...change}}}).status).toBe('failed');
});
it('rejects contradictory counts, duplicate kinds, malformed hashes and oversized archives', () => {
  for (const mutate of [
    (value: ReturnType<typeof fixture>) => {value.results.viewer.downloadedBytes++;},
    (value: ReturnType<typeof fixture>) => {value.results.seed.artifacts[0]!.kind = value.results.seed.artifacts[1]!.kind;},
    (value: ReturnType<typeof fixture>) => {value.results.seed.artifacts[0]!.sha256 = canary;},
    (value: ReturnType<typeof fixture>) => {value.results.backup.payloadBytes = 134217728;},
    (value: ReturnType<typeof fixture>) => {value.architecture = 'emulated';},
  ]) {const value = fixture(); mutate(value); expect(() => publicColdOutcome(value)).toThrow();}
});
it('requires an exact fresh Compose owner before any cleanup authority', () => {
  const owner = {root: '/tmp/beetle-compose-evidence-ABC123', project: 'beetle-qual-12345678', revision: 'a'.repeat(40), owner: '00000000-0000-4000-8000-000000000001'};
  expect(coldOwner(owner)).toEqual(owner);
  for (const patch of [{root: '/tmp/user-installation'}, {root: '/tmp/../tmp/beetle-compose-evidence-ABC123'}, {project: 'beetle-local'}, {revision: 'main'}, {owner: 'all'}, {extra: true}])
    expect(() => coldOwner({...owner, ...patch})).toThrow();
});
