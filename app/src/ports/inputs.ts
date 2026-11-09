import type { WorkspaceScope } from '@beetle/contracts/api';

/** Private application contracts; generated HTTP DTOs are added with transport.
 * Only the byte service may advance verified progress/publication/absence.
 * No HTTP handler exposes a generic metadata publication command.
 */
export const INPUT_MAXIMUM_BYTES = 8_388_608;
export const INPUT_CHUNK_BYTES = 65_536;
export const INPUT_METADATA_CHARGE_BYTES = 65_536;
export type InputState = 'staging' | 'publishing' | 'published' | 'deleting' | 'deleted' | 'failed';
export type InputFailure = 'custody_missing' | 'integrity' | 'io' | 'unverified_legacy';
export interface InputKey { scope: WorkspaceScope; id: string }
export interface InputRecord extends InputKey {
  name: string; folderId: string; sha256: string; bytes: number;
  offset: number; version: number; state: InputState; reason: InputFailure | null;
}
export interface InputCreateRequest {
  scope: WorkspaceScope; requestId: string; name: string; folderId?: string;
  sha256: string; bytes: number;
}
export interface InputTransitionRequest {
  scope: WorkspaceScope; requestId: string; expectedVersion: number;
}
export type InputControl =
  | { kind: 'createInput'; id: string; request: InputCreateRequest }
  | { kind: 'sealInput' | 'deleteInput'; id: string; request: InputTransitionRequest };
export type InputCommand = InputControl & { intentDigest: string };
/** Acceptance only; actual custody is read from the latest record. */
export interface InputReceipt extends InputKey {
  requestId: string; operation: 'seal' | 'delete'; acceptedVersion: number;
}
export type InputControlResult = InputRecord | InputReceipt;
export type InputAdvance =
  | { kind: 'commitInputOffset'; key: InputKey; expectedVersion: number; offset: number }
  | { kind: 'publishInput' | 'deleteInputBytes'; key: InputKey; expectedVersion: number }
  | { kind: 'failInput'; key: InputKey; expectedVersion: number; reason: InputFailure };
export interface InputList { scope: WorkspaceScope; limit: number; cursor?: string }
export interface InputRecoveryPage { limit: number; cursor?: string }
export interface InputPage { items: InputRecord[]; nextCursor: string | null }
export interface InputStorage {
  chargedBytes: number; allocationBytes: number; freeSpaceReserveBytes: number;
}
/** Shared receipts precede state/version checks; canonical intent excludes create
 * allocations and includes transition route IDs. One intent of each kind per input.
 * Creation reserves payload plus metadata charge plus configured free-space reserve
 * against current allocation; retained usage is charged only once. Seal requires
 * staging/offset==bytes; delete accepts staging/publishing/published/failed only.
 * Offset advances follow durable flush; publish follows verified promotion; delete
 * release follows durable absence. All advances check exact state and row version.
 * Failure during deletion records its reason but remains deleting for recovery;
 * failed inputs otherwise admit deletion only. Scoped pins and delete intent
 * serialize in this same worker transaction owner.
 */
export interface InputStore {
  control(command: InputCommand): Promise<InputControlResult>;
  advance(command: InputAdvance): Promise<InputRecord>;
  get(key: InputKey): Promise<InputRecord>;
  list(query: InputList): Promise<InputPage>;
  /** Internal maintenance scan; bounded cursor, no HTTP route. */
  recovery(query: InputRecoveryPage): Promise<InputPage>;
  storage(): Promise<InputStorage>;
}
