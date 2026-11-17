import assert from 'node:assert/strict';
import { runArtifactContentPath } from '@beetle/contracts/api';
import type { Run } from '@beetle/contracts/api';
import { readContent, hash } from '../compose/public.js';
import type { automaticSession } from '../compose/public.js';
import { readyContent } from '../compose/content-readiness.js';
import { finished, value } from '../public-api.js';
export async function finalDrain(client: Awaited<ReturnType<typeof automaticSession>>, run: Run) {
  const terminal = await finished(client.api, run, 200);
  const listed = value(
    await client.api.listRunArtifacts({
      params: { ...terminal.params, attemptId: run.activeAttemptId },
      query: { limit: 100 },
    }),
  );
  assert.equal(listed.availability, 'ready');
  assert.equal(listed.nextCursor, null);
  assert.deepEqual(
    listed.items.map((item) => item.kind).sort(),
    [
      'k6-diagnostics',
      'k6-warnings',
      'metric-index',
      'metric-windows',
      'metrics-csv',
      'native-summary',
      'numeric-final',
      'performance-report',
    ].sort(),
  );
  const artifacts = [];
  for (const item of listed.items) {
    assert(item.bytes <= 16777216);
    const path = runArtifactContentPath({
      ...terminal.params,
      attemptId: run.activeAttemptId,
      artifactId: item.artifactId,
    });
    const bytes = await readContent(await readyContent((signal) => client.content(path, {}, signal)), 16777216, 4096);
    assert.equal(bytes.length, item.bytes);
    assert.equal(hash(bytes), item.sha256);
    artifacts.push({ kind: item.kind, bytes: item.bytes, sha256: item.sha256 });
  }
  const live = await client.api.getRunLiveMetrics({ params: { ...terminal.params, attemptId: run.activeAttemptId } });
  assert(!live.ok && live.error.status === 503 && live.error.protocol?.code === 'storage_unavailable');
  return { artifacts, terminalLiveUnavailable: true };
}
