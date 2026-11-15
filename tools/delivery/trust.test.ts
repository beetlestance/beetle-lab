import {expect, it} from 'vitest';
import {captureQualifiedRun} from './trust.js';
import {maximumArtifactZipBytes} from './identity.js';

function fixture() {
  const expected = {runId: 17, revision: 'a'.repeat(40), workflowId: 23};
  const repo = {full_name: 'beetlestance/beetle-lab', id: 42};
  const run = {id: 17, workflow_id: 23, repository: repo, head_repository: {...repo},
    path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'rewrite/integration',
    head_sha: expected.revision, run_attempt: 1, status: 'completed', conclusion: 'success'};
  const names = ['ci/source', 'ci/legacy-container', 'ci/checks', 'ci/container',
    'ci/rewrite-container (amd64)', 'ci/rewrite-container (arm64)',
    ...Array.from({length: 6}, (_, index) => `ci/tests (${index + 1}/6)`)];
  const jobs = {total_count: names.length, jobs: names.map(name => ({name, run_id: 17,
    run_attempt: 1, head_sha: expected.revision, status: 'completed', conclusion: 'success'}))};
  const artifacts = {total_count: 8, artifacts: ['amd64', 'arm64'].flatMap((arch, index) =>
    ['images', 'native', 'supply-chain', 'roundtrip'].map((kind, ordinal) => ({
      id: index * 4 + ordinal + 1, name: `rewrite-${kind}-${arch}-${expected.revision}`, expired: false,
      size_in_bytes: 100, digest: `sha256:${'b'.repeat(64)}`, workflow_run: {id: 17,
        repository_id: 42, head_repository_id: 42, head_branch: 'rewrite/integration', head_sha: expected.revision}})))};
  return {input: {run, jobs, artifacts}, expected};
}
it('selects exactly eight immutable ZIP identities only after every gate succeeds', () => {
  const f = fixture(); const proof = captureQualifiedRun(f.input, f.expected);
  expect(proof.artifacts).toHaveLength(8); expect(proof.repositoryId).toBe(42);
  expect(proof.artifacts[0]).toEqual({id: 1, name: `rewrite-images-amd64-${f.expected.revision}`,
    bytes: 100, artifactDigest: `sha256:${'b'.repeat(64)}`});
  expect(Object.isFrozen(proof)).toBe(true); expect(Object.isFrozen(proof.artifacts[0])).toBe(true);
});
it.each(['pull_request', 'push', 'workflow_run'])('rejects the %s event even when its gates are green', event => {
  const f = fixture(); f.input.run.event = event;
  expect(() => captureQualifiedRun(f.input, f.expected)).toThrow('workflow run');
});
it.each(['run_attempt', 'workflow_id', 'id'])('rejects changed run identity %s', field => {
  const f = fixture(); Object.assign(f.input.run, {[field]: 99});
  expect(() => captureQualifiedRun(f.input, f.expected)).toThrow();
});
it.each(['head_sha', 'head_branch', 'path', 'status', 'conclusion'])('rejects changed run field %s', field => {
  const f = fixture(); Object.assign(f.input.run, {[field]: 'other'});
  expect(() => captureQualifiedRun(f.input, f.expected)).toThrow();
});
it('rejects a fork, renamed repository and mismatched repository ID', () => {
  for (const change of [{id: 99}, {full_name: 'attacker/beetle-lab'}]) {
    const f = fixture(); Object.assign(f.input.run.head_repository, change);
    expect(() => captureQualifiedRun(f.input, f.expected)).toThrow();
  }
});
it.each(['skipped', 'failure', 'cancelled', 'neutral'])('refuses a %s gate', conclusion => {
  const f = fixture(); f.input.jobs.jobs[0]!.conclusion = conclusion;
  expect(() => captureQualifiedRun(f.input, f.expected)).toThrow('gate');
});
it('refuses missing, duplicate and paginated gate lists', () => {
  for (const mutation of ['missing', 'duplicate', 'paginated']) {
    const f = fixture(); const page = f.input.jobs;
    if (mutation === 'missing') {page.jobs.pop(); page.total_count--;}
    if (mutation === 'duplicate') {page.jobs.push({...page.jobs[0]!}); page.total_count++;}
    if (mutation === 'paginated') page.total_count++;
    expect(() => captureQualifiedRun(f.input, f.expected)).toThrow();
  }
});
it.each(['run_id', 'run_attempt', 'head_sha'])('binds every gate to the original %s', field => {
  const f = fixture(); Object.assign(f.input.jobs.jobs[0]!, {[field]: 99});
  expect(() => captureQualifiedRun(f.input, f.expected)).toThrow();
});
it('rejects expired, oversized, undigested, misbound and aliased artifacts', () => {
  const changes = [{expired: true}, {size_in_bytes: 4 * 1024 ** 3}, {digest: ''}, {id: 2},
    {workflow_run: {id: 99}}, {size_in_bytes: Number.MAX_SAFE_INTEGER + 1}];
  for (const change of changes) {
    const f = fixture(); Object.assign(f.input.artifacts.artifacts[0]!, change);
    expect(() => captureQualifiedRun(f.input, f.expected)).toThrow();
  }
});
it('requires complete, uniquely named artifacts for both architectures', () => {
  for (const mutation of ['missing', 'duplicate', 'paginated', 'mixed-revision']) {
    const f = fixture(); const page = f.input.artifacts;
    if (mutation === 'missing') {page.artifacts.pop(); page.total_count--;}
    if (mutation === 'duplicate') {page.artifacts.push({...page.artifacts[0]!}); page.total_count++;}
    if (mutation === 'paginated') page.total_count++;
    if (mutation === 'mixed-revision') page.artifacts[0]!.name = page.artifacts[0]!.name.replace(f.expected.revision, 'c'.repeat(40));
    expect(() => captureQualifiedRun(f.input, f.expected)).toThrow();
  }
});
it('accepts the ZIP envelope ceiling independently of the inner archive bound', () => {
  const f = fixture(); f.input.artifacts.artifacts[0]!.size_in_bytes = maximumArtifactZipBytes;
  expect(captureQualifiedRun(f.input, f.expected).artifacts[0]!.bytes).toBe(maximumArtifactZipBytes);
  f.input.artifacts.artifacts[0]!.size_in_bytes++;
  expect(() => captureQualifiedRun(f.input, f.expected)).toThrow('artifact');
});
