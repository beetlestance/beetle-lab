import type { Ack, AckReceipt, AgentEvent, AttemptSnapshot, EventBatch, Offer } from '@beetle/contracts';

export type ErrorCode = 'invalid_input' | 'conflict' | 'not_found' | 'queue_full' |
  'closed' | 'unavailable' | 'owned' | 'schema_newer' | 'stale_generation' |
  'quota_exceeded' | 'cursor_expired' | 'expired_key';
export interface AttemptKey { attemptId: string; organizationId: string; workspaceId: string }
export interface GenerationKey extends AttemptKey { generation: number }
type WithoutSeq<T> = T extends unknown ? Omit<T, 'seq'> : never;
export interface SupervisorInput { sourceOrdinal: number; event: WithoutSeq<Extract<AgentEvent, { source: 'agent' }>> }
export interface SourceCursors { wrapperSeq: number; supervisorOrdinal: number }
export interface PageRequest { limit: number; cursor?: number }
export interface SnapshotPage { snapshots: AttemptSnapshot[]; cursor?: number }
export interface PruneReceipt { pruned: number; snapshot: AttemptSnapshot }
export interface EventInput {
  key: GenerationKey; source: 'wrapper' | 'agent'; sourceKey: number; json: string; canonical: string;
}
export type Operation =
  | { kind: 'offer'; json: string; canonical: string }
  | { kind: 'get' | 'cancel' | 'read'; key: AttemptKey }
  | { kind: 'list'; page: PageRequest }
  | { kind: 'append'; event: EventInput }
  | { kind: 'events'; key: GenerationKey; after: number }
  | { kind: 'ack'; ack: Ack }
  | { kind: 'prune' | 'sources'; key: GenerationKey }
  | { kind: 'close' };
export type Command = Operation & { id: number };
export type Value = AttemptSnapshot | SnapshotPage | Offer | AgentEvent | EventBatch | AckReceipt | PruneReceipt | SourceCursors | null;
export type Reply = { kind: 'ready' } | { kind: 'startup_error'; code: ErrorCode } |
  { kind: 'result'; id: number; ok: true; value: Value } |
  { kind: 'result'; id: number; ok: false; code: ErrorCode; recovery?: AttemptSnapshot };
