import type { RunHistorySummary, RunHistoryMetrics } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';

export interface RunHistoryJob extends RunKey {
  readonly attemptId: string;
  readonly manifestDigest: string | null;
  readonly sourceDigest: string | null;
  readonly absenceProofDigest: string | null;
  readonly expectedDueMs: number;
}
export type RunHistoryProjection = RunHistoryMetrics;
export interface RunHistoryMetricReader {
  /** Actual original through native result AND settlement, not an early caller race. */
  readRunHistorySummary(key: RunKey & { attemptId: string }, context: { signal: AbortSignal; deadline: number }): Promise<RunHistoryProjection>;
}
/** Original promises retain failed worker termination; shared store stays externally owned. */
export interface RetiredHistoryJob {readonly state:'retired';readonly id:string;readonly scope:RunHistoryJob['scope'];readonly attemptId:string}
export type HistoryJobRetirement=RetiredHistoryJob | (Omit<RetiredHistoryJob,'state'>&{readonly state:'deleting'});
export interface RunHistoryStore {
  /** Positive deletion/retirement metadata; null cannot excuse a missing record. */
  retirement(job:RunHistoryJob):Promise<HistoryJobRetirement|null>;
  scan(query: { nowMs: number; limit: number }): Promise<RunHistoryJob[]>;
  defer(request: { job: RunHistoryJob; dueMs: number }): Promise<null|RetiredHistoryJob>;
  commit(request: { job: RunHistoryJob; summary: RunHistorySummary }): Promise<RunHistorySummary|RetiredHistoryJob>;
}
export interface RunHistoryIndexerState {
  readonly status: 'running' | 'failed' | 'closed';
  readonly active: boolean;
  readonly problem: 'deadline' | 'operation' | null;
}
export interface RunHistoryIndexer {
  state(): RunHistoryIndexerState;
  close(): Promise<void>;
}

export type HistoryRequest = {method:'retirement';request:{job:RunHistoryJob}} | { method: 'scan'; query: Parameters<RunHistoryStore['scan']>[0] }
  | { method: 'defer'; request: Parameters<RunHistoryStore['defer']>[0] }
  | { method: 'commit'; request: Parameters<RunHistoryStore['commit']>[0] };
export interface HistoryOperation { kind: 'historySummary'; operation: HistoryRequest }
