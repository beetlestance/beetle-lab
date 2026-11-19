import { startRunHistoryIndexer } from '../application/run-history-index/index.js';
import type { Metadata } from '../adapters/outbound/sqlite/index.js';
import type { RunHistoryIndexerState, RunHistoryMetricReader } from '../ports/run-history.js';

/** Indexing borrows the public metrics reader; it never creates or closes another parser. */
export function openHistoryIndex(
  store: Pick<Metadata, 'historySummaries'>,
  metrics: RunHistoryMetricReader | undefined,
  onFailure: (problem: 'deadline' | 'operation') => Promise<void>,
) {
  if (!metrics) return { state: (): 'disabled' => 'disabled', close: async () => undefined };
  const indexer = startRunHistoryIndexer({ store: store.historySummaries, metrics, onFailure });
  return { state: (): RunHistoryIndexerState => indexer.state(), close: () => indexer.close() };
}
