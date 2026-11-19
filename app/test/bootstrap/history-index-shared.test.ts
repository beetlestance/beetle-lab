import { expect, it, vi } from 'vitest';
import { openHistoryIndex } from '../../src/bootstrap/history-index.js';
import { createRunMetricsService } from '../../src/application/run-metrics/index.js';
import type { RunHistoryJob, RunHistoryStore } from '../../src/ports/run-history.js';
import { fixture, context, digest } from '../run-metrics/fixture.js';
import { deferred, pending } from '../files/output-bytes/fixture.js';

it('hands the bootstrap index reader to public queries and leaves reader ownership with the caller', async () => {
  const f = await fixture();
  const entered = deferred();
  const held = deferred();
  let metadata = 0;
  const metrics = createRunMetricsService({
    artifacts: {
      ...f.reader,
      async listRunArtifacts(q) {
        metadata++;
        if (metadata === 1) {
          entered.resolve();
          await held.promise;
        }
        return f.reader.listRunArtifacts(q);
      },
    },
    bytes: f.bytes,
    createDigest: digest,
  });
  const job: RunHistoryJob = {
    ...f.query,
    manifestDigest: 'c'.repeat(64),
    sourceDigest: null,
    absenceProofDigest: null,
    expectedDueMs: 0,
  };
  let committed = false;
  const store: RunHistoryStore = {
    scan: async () => (committed ? [] : [job]),
    retirement: async () => null,
    defer: async () => {
      throw new Error('Shared reader unexpectedly deferred');
    },
    commit: async ({ summary }) => {
      committed = true;
      return summary;
    },
  };
  const failed = vi.fn(async () => undefined);
  const index = openHistoryIndex({ historySummaries: store }, metrics, failed);
  await entered.promise;
  const read = metrics.reader.listRunMetricSeries(f.query, context());
  void read.catch(() => undefined);
  try {
    expect(await pending(read)).toBe(true);
    expect(metadata).toBe(1);
    held.resolve();
    expect(await read).toMatchObject({ availability: 'ready', id: job.id });
    expect(committed).toBe(true);
    expect(metadata).toBe(2);
    await index.close();
    expect(await metrics.reader.listRunMetricSeries(f.query, context())).toMatchObject({ availability: 'ready' });
    expect(failed).not.toHaveBeenCalled();
  } finally {
    held.resolve();
    await Promise.allSettled([read, index.close()]);
    await metrics.close();
  }
});

it('disables indexing without constructing or owning a metrics reader', async () => {
  const index = openHistoryIndex({ historySummaries: {} as RunHistoryStore }, undefined, async () => undefined);
  expect(index.state()).toBe('disabled');
  await index.close();
});
