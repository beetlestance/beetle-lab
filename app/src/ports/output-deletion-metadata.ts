import type { RetirementReply } from '@beetle/contracts/output-retirement';
import type { RetirementRequest as OutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { OutputFileRecord } from './output-bytes.js';
import type { OutputDeletionRequest, OutputDeletionReceipt } from './output-deletion.js';
export interface BeginOutputDeletionRequest {readonly scope: WorkspaceScope; readonly requestId: string; readonly runId: string; readonly expectedRunVersion: number}
export interface OutputDeletionCommand {readonly kind: 'beginOutputDeletion'; readonly id: string; readonly requestedAt: string; readonly request: BeginOutputDeletionRequest; readonly intentDigest: string}
export interface OutputDeletionKey {readonly scope: WorkspaceScope; readonly id: string; readonly runId: string}
export interface OutputCleanupAck {readonly version:1;readonly reply:RetirementReply;readonly replyDigest:string;readonly logicalBytes:number}
export type OutputCleanupAckState = {readonly kind:'missing'} | {readonly kind:'stored';readonly ack:OutputCleanupAck};
export interface OutputCleanupAckWrite {readonly key:OutputDeletionKey;readonly reply:RetirementReply}
export interface OutputDeletionFileKey extends OutputDeletionKey {readonly ordinal: number}
export interface OutputDeletionSummary {
  readonly id: string; readonly scope: WorkspaceScope; readonly requestId: string; readonly runId: string; readonly runVersion: number;
  readonly deletionVersion: 1; readonly version: number; readonly kind: 'source' | 'absence' | 'unsent'; readonly stage: 'pending' | 'files_absent';
  readonly fileCount: number; readonly preparedCount: number; readonly absentCount: number;
  readonly retainedPayloadBytes: number; readonly metadataBytes: number; readonly requestedAt: string;
}
export interface OutputDeletionFile {
  readonly deletionId: string; readonly deletionVersion: 1; readonly record: OutputFileRecord; readonly version: number;
  readonly phase: 'pending_preparation' | 'prepared' | 'absent'; readonly namespaceIdentity: string | null; readonly preparationIdentity: string | null;
}
export interface OutputDeletionPlanWrite {readonly key: OutputDeletionFileKey; readonly expectedVersion: number; readonly plan: OutputDeletionRequest}
export interface OutputDeletionAbsenceWrite {readonly key: OutputDeletionFileKey; readonly expectedVersion: number; readonly receipt: OutputDeletionReceipt}
export interface OutputDeletionScan {readonly limit: number; readonly cursor?: string}
export interface OutputDeletionPage {readonly items: readonly OutputDeletionSummary[]; readonly nextCursor: string | null}
export type OutputDeletionOperation =
  | {readonly kind: 'beginOutputDeletion'; readonly command: OutputDeletionCommand}
  | {readonly kind: 'getOutputDeletion'; readonly key: OutputDeletionKey}
  | {readonly kind: 'getOutputRetirementRequest'; readonly key: OutputDeletionKey}
  | {readonly kind: 'reserveOutputCleanupControl'; readonly key: OutputDeletionKey}
  | {readonly kind: 'getOutputCleanupAck'; readonly key: OutputDeletionKey}
  | {readonly kind: 'recordOutputCleanupAck'; readonly request: OutputCleanupAckWrite}
  | {readonly kind: 'getOutputDeletionFile'; readonly key: OutputDeletionFileKey}
  | {readonly kind: 'recordOutputDeletionPlan'; readonly request: OutputDeletionPlanWrite}
  | {readonly kind: 'recordOutputDeletionAbsence'; readonly request: OutputDeletionAbsenceWrite}
  | {readonly kind: 'scanOutputDeletions'; readonly query: OutputDeletionScan}
  | {readonly kind: 'scanOutputRetirements'; readonly query: OutputDeletionScan}
  | {readonly kind: 'scanOutputSettlements'; readonly query: OutputDeletionScan};
export type OutputDeletionValue = OutputCleanupAck | OutputCleanupAckState | OutputRetirementRequest | OutputDeletionSummary | OutputDeletionFile | OutputDeletionPage;
/** Progress only: preserve producer authority and ALL charges until a separate
 * reviewed retirement/purge/refund owner exists. Private native response input. */
export interface OutputDeletionMetadata {
  begin(command: OutputDeletionCommand): Promise<OutputDeletionSummary>;
  get(key: OutputDeletionKey): Promise<OutputDeletionSummary>;
  /** Exact retained original after all backend file receipts; unsent refuses. */
  retirementRequest(key: OutputDeletionKey): Promise<OutputRetirementRequest>;
  /** Explicit legacy top-up, before any further destructive work. */
  reserveControl(key: OutputDeletionKey): Promise<OutputDeletionSummary>;
  cleanupAck(key:OutputDeletionKey):Promise<OutputCleanupAckState>;
  recordCleanupAck(request:OutputCleanupAckWrite):Promise<OutputCleanupAck>;
  getFile(key: OutputDeletionFileKey): Promise<OutputDeletionFile>;
  recordPlan(request: OutputDeletionPlanWrite): Promise<OutputDeletionFile>;
  recordAbsence(request: OutputDeletionAbsenceWrite): Promise<OutputDeletionFile>;
  scan(query: OutputDeletionScan): Promise<OutputDeletionPage>;
  /** Bounded physical candidates; empty eligible pages may still advance cursor. */
  scanRetirements(query:OutputDeletionScan):Promise<OutputDeletionPage>;
  /** Bounded physical original horizon; only funded/proven branches are selected. */
  scanSettlements(query:OutputDeletionScan):Promise<OutputDeletionPage>;
}
