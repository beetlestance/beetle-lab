import type { AttemptSnapshot, Offer } from '@beetle/contracts';

export type ErrorCode = 'invalid_input' | 'conflict' | 'not_found' | 'queue_full' |
  'closed' | 'unavailable' | 'owned' | 'schema_newer';
export interface AttemptKey { attemptId: string; organizationId: string; workspaceId: string }
export interface PageRequest { limit: number; cursor?: number }
export interface SnapshotPage { snapshots: AttemptSnapshot[]; cursor?: number }
export type Operation =
  | { kind: 'offer'; json: string; canonical: string }
  | { kind: 'get' | 'cancel' | 'read'; key: AttemptKey }
  | { kind: 'list'; page: PageRequest }
  | { kind: 'close' };
export type Command = Operation & { id: number };
export type Value = AttemptSnapshot | SnapshotPage | Offer | null;
export type Reply = { kind: 'ready' } | { kind: 'startup_error'; code: ErrorCode } |
  { kind: 'result'; id: number; ok: true; value: Value } |
  { kind: 'result'; id: number; ok: false; code: ErrorCode };
