import assert from 'node:assert/strict';
import type { ApiClient, Run, RunHistorySummary } from '@beetle/contracts/api';
import type { Application } from '../../../app/src/bootstrap/api.js';
import { value } from './public-api.js';
/** Bounded observer of the normal indexer; never supplies a projection or repeats load. */
export async function observedHistory(api: ApiClient, run: Run, state: Application['historySummaryState']): Promise<RunHistorySummary> {
  const deadline = performance.now() + 30000;
  const params = { organizationId: run.scope.organizationId, workspaceId: run.scope.workspaceId };
  for (let calls = 0; calls < 60; calls++) {
    assert(performance.now() < deadline, 'History indexing qualification deadline');
    const index = state(); assert(index !== 'disabled' && index.status === 'running', 'Installed history indexer unavailable');
    const page = value(await api.listRuns({ params, query: { limit: 1 } }));
    assert.equal(page.items[0]?.id, run.id); const summary = page.summaries[0];
    if (summary?.availability === 'ready') {
      qualified(summary);
      return summary;
    }
    assert(summary?.availability === 'pending', 'Native history projection failed');
    await new Promise<void>(resolve => setTimeout(resolve, 250));
  }
  throw new Error('History indexing observation budget exceeded');
}

function qualified(summary: RunHistorySummary): void {
  assert.equal(summary.source?.numericVersion, 4); assert.equal(summary.requestCount, 1);
  assert(summary.testDurationMs !== null && summary.testDurationMs > 0);
  assert.equal(summary.requestsPerSecond, 1 / (summary.testDurationMs / 1000));
  assert.equal(summary.httpSamples, 1); assert(summary.httpP95 !== null);
  assert(summary.publishedArtifactBytes !== null && summary.publishedArtifactBytes > 0);
  assert(summary.retainedLogicalBytes !== null && summary.retainedLogicalBytes >= summary.publishedArtifactBytes + 65536);
}
