import {expect, it} from 'vitest';
import {captureDeliveryRun} from './delivery-run.js';
import {publicationFixture} from './fixture.js';
function fixture() {
  const {plan} = publicationFixture(); const revision = 'c'.repeat(40); const runId = 41; const repository = {id: 42, full_name: 'beetlestance/beetle-lab'};
  const run = {id: runId, workflow_id: 23, path: '.github/workflows/ci.yml', event: 'workflow_dispatch', head_branch: 'rewrite/integration',
    head_sha: revision, run_attempt: 1, status: 'completed', conclusion: 'success', repository, head_repository: repository};
  const jobs = ['delivery/publish', 'delivery/anonymous-native (amd64)', 'delivery/anonymous-native (arm64)'].map(name => ({
    name: 'delivery/qualified-candidates / ' + name, run_id: runId, run_attempt: 1, head_sha: revision, status: 'completed', conclusion: 'success'}));
  const artifacts = [`rewrite-published-${plan.revision}-${plan.sourceRunId}`, ...['amd64', 'arm64'].map(arch => `rewrite-anonymous-${arch}-${plan.revision}-${plan.sourceRunId}`)]
    .map((name, index) => ({name, id: index + 1, size_in_bytes: 100, digest: 'sha256:' + 'd'.repeat(64), expired: false,
      workflow_run: {id: runId, repository_id: 42, head_repository_id: 42, head_sha: revision, head_branch: 'rewrite/integration'}}));
  return {plan, revision, runId, metadata: {workflowId: 23, run, jobs: {total_count: 3, jobs}, artifacts: {total_count: 3, artifacts}}};
}
it('requires both successful anonymous native gates and exact immutable publication artifacts', () => {
  const f = fixture(); expect(captureDeliveryRun(f.metadata, f.runId, f.revision, f.plan).map(row => row.id)).toEqual([1, 2, 3]);
});
it('rejects failed, skipped, missing or duplicate native gates and reruns', () => {
  for (const failure of ['failure', 'skipped', 'missing', 'duplicate', 'rerun']) {
    const f = fixture(); const page = f.metadata.jobs;
    if (failure === 'missing') {page.jobs.pop(); page.total_count--;}
    else if (failure === 'duplicate') {page.jobs.push({...page.jobs[0]!}); page.total_count++;}
    else if (failure === 'rerun') f.metadata.run.run_attempt = 2;
    else page.jobs[1]!.conclusion = failure;
    expect(() => captureDeliveryRun(f.metadata, f.runId, f.revision, f.plan)).toThrow();
  }
});
it('rejects expired, foreign-run, mixed-candidate, incomplete and aliased artifact lists', () => {
  for (const failure of ['expired', 'foreign', 'mixed', 'page', 'alias']) {
    const f = fixture(); const page = f.metadata.artifacts;
    if (failure === 'expired') page.artifacts[0]!.expired = true;
    if (failure === 'foreign') page.artifacts[1]!.workflow_run.id = 99;
    if (failure === 'mixed') page.artifacts[1]!.name += '-other';
    if (failure === 'page') page.total_count++;
    if (failure === 'alias') page.artifacts[1]!.id = page.artifacts[0]!.id;
    expect(() => captureDeliveryRun(f.metadata, f.runId, f.revision, f.plan)).toThrow();
  }
});
