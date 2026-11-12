import type {OutputArtifactState} from '../../../../ports/output-custody.js';
import type {OutputFileReceipt} from '../../../../ports/output-bytes.js';
import {StorageError} from '../protocol.js';
import {artifactSlot} from '../output-custody/slot.js';
import type {Slot} from '../output-custody/slot.js';
type Claim={writerId:string;expectedVersion:number};
type Progress=Claim & {receipt:OutputFileReceipt};
export type ArtifactTransition={kind:'outputClaimArtifact';request:Claim}|{kind:'outputBeginPublication';request:Claim}
 | {kind:'outputRecordProgress';request:Progress}|{kind:'outputRecordPublication';request:Progress};
function conflict(condition:boolean):void{if(!condition)throw new StorageError('conflict');}
function transition(operation: ArtifactTransition, current: OutputArtifactState): Slot {
  const request = operation.request; const next = artifactSlot(current);
  conflict(request.expectedVersion <= current.version);
  if (operation.kind === 'outputClaimArtifact') {
    if (current.phase === 'published' || current.writer === request.writerId) return next;
    conflict(current.phase === 'transferring' && current.writer === null); next.w = request.writerId;
  } else if (operation.kind === 'outputRecordPublication') {
    const receipt = operation.request.receipt;
    conflict(receipt.token === current.token && receipt.offset === current.bytes);
    if (current.phase === 'published') {
      conflict(current.identity === receipt.identity && current.offset === receipt.offset); return next;
    }
    conflict(current.writer === request.writerId && current.phase === 'publishing');
    next.p = 'published'; next.w = null; next.i = receipt.identity;
  } else {
    conflict(current.writer === request.writerId);
    return transferTransition(operation, current, next);
  }
  return changed(request.expectedVersion, current.version, next);
}
function transferTransition(operation: Exclude<ArtifactTransition, {kind: 'outputRecordPublication' | 'outputClaimArtifact'}>,
  current: OutputArtifactState, next: Slot): Slot {
  if (operation.kind === 'outputBeginPublication') {
    if (current.phase === 'publishing') return next;
    conflict(current.phase === 'transferring' && current.offset === current.bytes && current.identity !== null);
    next.p = 'publishing';
  } else {
    const receipt = operation.request.receipt;
    conflict(receipt.token === current.token && receipt.offset <= current.bytes);
    conflict(current.identity === null || current.identity === receipt.identity);
    if (current.identity === receipt.identity && current.offset >= receipt.offset) return next;
    conflict(current.phase === 'transferring'); next.o = receipt.offset; next.i = receipt.identity;
  }
  return changed(operation.request.expectedVersion, current.version, next);
}
function changed(expected: number, version: number, next: Slot): Slot {
  conflict(expected === version && version < Number.MAX_SAFE_INTEGER); next.v = version + 1; return next;
}
export function transitionArtifact(operation:ArtifactTransition,current:OutputArtifactState):OutputArtifactState {
 const next=transition(operation,current);return {...current,version:next.v,writer:next.w,phase:next.p,offset:next.o,identity:next.i};
}
