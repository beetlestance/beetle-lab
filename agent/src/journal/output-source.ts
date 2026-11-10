import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import type { Reservation, Scope } from '../admission/index.js';
import { captureCollectionIntent, verifyOutputSource, receiptForOutputSource } from '../output-source/index.js';
import type { CollectionIntent, PrivateSource, SourceReceipt } from '../output-source/index.js';
import { parseSourceJson, requireSource, sameSource, sourceHash, sourceJson, sourceCaps, sourceScope, copyReceipt, copyFailed } from './output-source-input.js';
import type { FailedOutputCollection, OutputSourceOperation } from './output-source-protocol.js';
import { bindingKey, matchOriginal, matchIntent, readSourceState } from './output-source-context.js';
import { releaseSettled, requireSettledRelease } from './launch-settlement.js';
import { Failure, quotaUsed, transaction } from './sql.js';
import type { Value } from './protocol.js';

export function outputSourceOperation(input: { kind: string }): input is OutputSourceOperation {
  return ['outputCollectionBegin', 'outputCollectionRead', 'outputSourceCommit', 'outputSourceRead', 'outputSourceRelease', 'outputCollectionFailed'].includes(input.kind);
}
function checkedOperation(input: OutputSourceOperation): unknown {
  try {
    if (input.kind === 'outputCollectionRead' || input.kind === 'outputSourceRead') return sourceScope(input.key);
    const value = parseSourceJson(input.json, sourceCaps[input.kind]);
    switch (input.kind) {
      case 'outputCollectionBegin': return captureCollectionIntent(value);
      case 'outputSourceCommit': return verifyOutputSource(value, sourceHash);
      case 'outputSourceRelease': return copyReceipt(value);
      case 'outputCollectionFailed': return copyFailed(value);
    }
  } catch { throw new Failure('invalid_input'); }
}
/** One per-open epoch; caller data cannot manufacture an uninterrupted owner. */
export class OutputSources {
  private readonly epoch = randomUUID();
  constructor(private readonly db: DatabaseSync) {}
  execute(input: OutputSourceOperation): Value {
    const value = checkedOperation(input);
    return transaction(this.db, () => {
      switch (input.kind) {
        case 'outputCollectionRead': return readSourceState(this.db, value as Scope).intent?.value ?? null;
        case 'outputSourceRead': return readSourceState(this.db, value as Scope).source;
        case 'outputCollectionBegin': return this.begin(value as CollectionIntent);
        case 'outputSourceCommit': return this.commit(value as PrivateSource);
        case 'outputSourceRelease': return this.release(value as SourceReceipt);
        case 'outputCollectionFailed': return this.failed(value as FailedOutputCollection);
      }
    });
  }
  private begin(input: CollectionIntent): CollectionIntent {
    const state = readSourceState(this.db, bindingKey(input.binding));
    if (state.intent) { requireSource(sameSource(state.intent.value, input), 'conflict'); return state.intent.value; }
    const current = matchOriginal(this.db, input); requireSource(current.reservation.status === 'charged', 'conflict');
    const json = sourceJson(input, sourceCaps.outputCollectionBegin); const charge = Buffer.byteLength(json) + 256;
    if (quotaUsed(current.row, { collection_bytes: charge }) > current.row.quota_bytes) throw new Failure('quota_exceeded');
    this.db.prepare(`INSERT INTO output_collection_intents(attempt_id,collection_id,intent_json,charged_bytes,phase,created_epoch)
      VALUES(?,?,?,?,'pending',?)`).run(input.binding.attemptId, input.collectionId, json, charge, this.epoch);
    return input;
  }
  private commit(input: PrivateSource): SourceReceipt {
    const state = readSourceState(this.db, bindingKey(input.manifest.binding));
    if (state.source) { requireSource(sameSource(state.source, input), 'conflict'); return receiptForOutputSource(state.source, sourceHash); }
    requireSource(state.intent?.phase === 'pending' && state.reservation?.status === 'charged', 'conflict');
    matchIntent(input, state.intent.value, state.reservation);
    const current = matchOriginal(this.db, state.intent.value);
    requireSource(sameSource(input.manifest.result, current.result), 'conflict');
    const json = sourceJson(input, sourceCaps.outputSourceCommit); const charge = Buffer.byteLength(json) + 256;
    if (quotaUsed(state.row, { source_bytes: charge }) > state.row.quota_bytes) throw new Failure('quota_exceeded');
    this.db.prepare(`INSERT INTO output_sources(attempt_id,source_json,manifest_digest,source_digest,charged_bytes) VALUES(?,?,?,?,?)`)
      .run(input.manifest.binding.attemptId, json, input.manifest.manifestDigest, input.sourceDigest, charge);
    return receiptForOutputSource(input, sourceHash);
  }
  private release(input: SourceReceipt): Reservation {
    const state = readSourceState(this.db, input.key);
    requireSource(state.source && sameSource(receiptForOutputSource(state.source, sourceHash), input), 'conflict');
    return releaseSettled(this.db, state.source.release);
  }
  private failed(input: FailedOutputCollection): Reservation {
    const state = readSourceState(this.db, input.evidence.key);
    requireSource(state.intent && !state.source && state.reservation, 'conflict');
    const intent = state.intent.value;
    if (state.intent.phase === 'failed') {
      requireSource(state.reservation.status === 'released', 'unavailable');
      requireSource(input.collectionId === intent.collectionId && sameSource(input.evidence, state.reservation.releaseEvidence), 'conflict');
      return state.reservation;
    }
    requireSource(state.intent.phase === 'pending' && state.intent.epoch === this.epoch && state.reservation.status === 'charged', 'conflict');
    requireSource(input.collectionId === intent.collectionId && sameSource(input.evidence.runtime, intent.runtime), 'conflict');
    requireSource(input.evidence.collection.observedAt >= intent.begunAt, 'conflict');
    requireSettledRelease(state.reservation, input.evidence);
    return releaseSettled(this.db, input.evidence);
  }
}
