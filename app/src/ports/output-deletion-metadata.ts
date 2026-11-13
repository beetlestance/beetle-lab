import type { RetirementRequest as OutputRetirementRequest } from '@beetle/contracts/output-retirement';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { OutputFileRecord } from './output-bytes.js';
import type { OutputDeletionRequest, OutputDeletionReceipt } from './output-deletion.js';
export interface BeginOutputDeletionRequest {readonly scope: WorkspaceScope; readonly requestId: string; readonly runId: string; readonly expectedRunVersion: number}
export interface OutputDeletionCommand {readonly kind: 'beginOutputDeletion'; readonly id: string; readonly requestedAt: string; readonly request: BeginOutputDeletionRequest; readonly intentDigest: string}
export interface OutputDeletionKey {readonly scope: WorkspaceScope; readonly id: string; readonly runId: string}
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
  | {readonly kind: 'getOutputDeletionFile'; readonly key: OutputDeletionFileKey}
  | {readonly kind: 'recordOutputDeletionPlan'; readonly request: OutputDeletionPlanWrite}
  | {readonly kind: 'recordOutputDeletionAbsence'; readonly request: OutputDeletionAbsenceWrite}
  | {readonly kind: 'scanOutputDeletions'; readonly query: OutputDeletionScan};
export type OutputDeletionValue = OutputRetirementRequest | OutputDeletionSummary | OutputDeletionFile | OutputDeletionPage;
/** Progress only: preserve producer authority and ALL charges until a separate
 * reviewed retirement/purge/refund owner exists. Private native response input. */
export interface OutputDeletionMetadata {
  begin(command: OutputDeletionCommand): Promise<OutputDeletionSummary>;
  get(key: OutputDeletionKey): Promise<OutputDeletionSummary>;
  /** Exact retained original after all backend file receipts; unsent refuses. */
  retirementRequest(key: OutputDeletionKey): Promise<OutputRetirementRequest>;
  getFile(key: OutputDeletionFileKey): Promise<OutputDeletionFile>;
  recordPlan(request: OutputDeletionPlanWrite): Promise<OutputDeletionFile>;
  recordAbsence(request: OutputDeletionAbsenceWrite): Promise<OutputDeletionFile>;
  scan(query: OutputDeletionScan): Promise<OutputDeletionPage>;
}
