import { createHash } from 'node:crypto';
import { createRunMetricsService } from '../application/run-metrics/index.js';
import { startRunHistoryIndexer } from '../application/run-history-index/index.js';
import { throwCloseFailures } from './application-close.js';
import type { Metadata } from '../adapters/outbound/sqlite/index.js';
import type { OutputByteStore } from '../ports/output-bytes.js';
import type { RunHistoryIndexerState } from '../ports/run-history.js';

/** Derivative indexing shares installed read custody, with its own single original. */
export function openHistoryIndex(store: Metadata, bytes: Pick<OutputByteStore, 'read'> | undefined,
  onFailure: (problem: 'deadline' | 'operation') => Promise<void>) {
  if (!bytes) return { state: (): 'disabled' => 'disabled', close: async () => undefined };
  const metrics = createRunMetricsService({ artifacts: store.runArtifacts, bytes,
    createDigest: () => { const hash = createHash('sha256'); return { update: chunk => { hash.update(chunk); }, hex: () => hash.digest('hex') }; } });
  const indexer = startRunHistoryIndexer({ store: store.historySummaries, metrics, onFailure });
  let closing: Promise<void> | undefined;
  return { state: (): RunHistoryIndexerState => indexer.state(), close() {
    closing ??= Promise.resolve().then(async () => {
      const indexed = await Promise.allSettled([indexer.close()]);
      const services = await Promise.allSettled([metrics.close()]);
      throwCloseFailures([...indexed, ...services]);
    });
    return closing;
  } };
}
