import type { InputControl, InputControlResult, InputKey, InputList, InputPage,
  InputRecord, InputRecoveryPage } from './inputs.js';
import type { InputChunkSource, InputContentRange, InputContentSink } from './input-bytes.js';

export interface InputOperationContext { readonly signal?: AbortSignal }
export interface InputRecoveryResult {
  /** Reconciled means state-appropriate custody, not upload/publication completion. */
  examined: number; reconciled: number; busy: number; pending: number; nextCursor: string | null;
}
/** No byte effects on create/replay. Seal/delete return original acceptance receipts;
 * status remains authoritative even if optional inline reconciliation cannot finish.
 */
export interface InputService {
  control(command: InputControl, context?: InputOperationContext): Promise<InputControlResult>;
  append(key: InputKey, offset: number, source: InputChunkSource, context?: InputOperationContext): Promise<InputRecord>;
  read(key: InputKey, range: InputContentRange | undefined, sink: InputContentSink,
    context?: InputOperationContext): Promise<InputRecord>;
  get(key: InputKey): Promise<InputRecord>;
  list(query: InputList): Promise<InputPage>;
  /** One bounded page; admission and state are rechecked for every item. */
  recover(query: InputRecoveryPage, context?: InputOperationContext): Promise<InputRecoveryResult>;
  /** Synchronously fences intake; cannot report drained while any custody remains. */
  close(): Promise<void>;
}
