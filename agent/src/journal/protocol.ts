import type { Ack, AckReceipt, AgentEvent, AttemptSnapshot, EventBatch, Offer, StandaloneExportAssignment } from '@beetle/contracts';
import type { WrapperBatch, WrapperCheckpoint } from '../control-protocol/index.js';
import type { AdmissionCommand, AdmissionValue } from '../admission/index.js';
import type { CollectionIntent, PrivateSource, SourceReceipt } from '../output-source/index.js';
import type { OutputSourceOperation } from './output-source-protocol.js';
import type { OutputDeliveryOperation, OutputDeliveryClosure } from './output-delivery-protocol.js';
import type { OutputAbsence } from '@beetle/contracts/output-source';
import type { OutputAbsenceOperation } from './output-absence-protocol.js';

export type ErrorCode = 'invalid_input' | 'conflict' | 'not_found' | 'queue_full' |
  'closed' | 'unavailable' | 'owned' | 'schema_newer' | 'stale_generation' |
  'quota_exceeded' | 'cursor_expired' | 'expired_key' | 'recovery_required';
export interface AttemptKey { attemptId: string; organizationId: string; workspaceId: string }
export interface GenerationKey extends AttemptKey { generation: number }
/** Private supervisor input. now is trusted wall-clock milliseconds, never job data. */
export type StopReason = 'cancelled' | 'timeout' | 'output_limit' | 'artifact_incomplete' | 'clock_integrity';
export interface SupervisionCommand { key: GenerationKey; now: number; cancel?: true; reason?: StopReason }
export interface SupervisionState {
  clockHighWater: number;
  clockFenced: boolean;
  cancelRequestedAt: number | null;
  cancelRequested: boolean;
  cancelReason: StopReason | null;
  immediateStop: boolean;
}
type WithoutSeq<T> = T extends unknown ? Omit<T, 'seq'> : never;
export interface SupervisorInput { sourceOrdinal: number; event: WithoutSeq<Extract<AgentEvent, { source: 'agent' }>> }
export interface SourceCursors { wrapperSeq: number; supervisorOrdinal: number }
export interface PageRequest { limit: number; cursor?: number }
export interface SnapshotPage { snapshots: AttemptSnapshot[]; cursor?: number }
/** Private discovery. Each lane owns its cursor; delivery also pins a finite upper ID. */
export interface RunnableRequest extends PageRequest { lane: 'charged' | 'queued' | 'delivery'; through?: number }
export interface RunnablePage { attempts: GenerationKey[]; cursor?: number; through?: number }
export interface PruneReceipt { pruned: number; snapshot: AttemptSnapshot }
export interface EventInput {
  key: GenerationKey; source: 'wrapper' | 'agent'; sourceKey: number; json: string; canonical: string;
}
export type Operation = OutputSourceOperation | OutputDeliveryOperation | OutputAbsenceOperation
  | { kind: 'authority' }
  | { kind: 'checkpoint'; key: GenerationKey }
  | { kind: 'wrapperBatch'; request: Readonly<WrapperBatch> }
  | { kind: 'supervision'; request: SupervisionCommand }
  | { kind: 'admission'; request: AdmissionCommand }
  | { kind: 'offer'; json: string; canonical: string }
  | { kind: 'cancelOriginal'; json: string; canonical: string; now: number; assignment?:StandaloneExportAssignment }
  | { kind: 'get' | 'cancel' | 'read' | 'readExportAssignment'; key: AttemptKey }
  | { kind: 'list'; page: PageRequest }
  | { kind: 'runnable'; page: RunnableRequest }
  | { kind: 'append'; event: EventInput }
  | { kind: 'events'; key: GenerationKey; after: number }
  | { kind: 'ack'; ack: Ack }
  | { kind: 'prune' | 'sources'; key: GenerationKey }
  | { kind: 'close' };
export type Command = Operation & { id: number };
export type Value = AttemptSnapshot | SnapshotPage | RunnablePage | Offer | StandaloneExportAssignment | AgentEvent | EventBatch | AckReceipt | PruneReceipt | SourceCursors | AdmissionValue | SupervisionState | WrapperCheckpoint | CollectionIntent | PrivateSource | SourceReceipt | OutputDeliveryClosure | OutputAbsence | string | null;
export type Reply = { kind: 'ready' } | { kind: 'startup_error'; code: ErrorCode } |
  { kind: 'result'; id: number; ok: true; value: Value } |
  { kind: 'result'; id: number; ok: false; code: ErrorCode; recovery?: AttemptSnapshot };
