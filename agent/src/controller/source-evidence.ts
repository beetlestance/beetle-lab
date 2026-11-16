import { createHash } from 'node:crypto';
import type { Reservation } from '../admission/index.js';
import type { FailedOutputCollection } from '../journal/index.js';
import type { OutputCollectionResult, OutputRootIdentity } from '../collection/output/index.js';
import type { WrapperCheckpoint } from '../control-protocol/index.js';
import { captureCollectionIntent, prepareOutputSource, receiptForOutputSource } from '../output-source/index.js';
import type { CollectionIntent, CollectedSource, SourceReceipt } from '../output-source/index.js';
import type { LaunchState } from '../supervisor/index.js';
import type { CollectionAuthority } from './authority.js';
import { releaseEvidence } from './release.js';
import { sameSourceFact } from './source-recovery.js';
import { ControllerError } from './types.js';

export const sourceHash = (text: string): string => createHash('sha256').update(text).digest('hex');
export function newIntent(input: { authority: CollectionAuthority; current: Reservation; state: LaunchState;
  root: Readonly<OutputRootIdentity>; checkpoint: Readonly<WrapperCheckpoint>; now: number }): CollectionIntent | null {
  const release = releaseEvidence({ reservation: input.current, state: input.state,
    collection: { state: 'failed', observedAt: input.now }, runtimeAt: input.now });
  if (!release) return null;
  return captureCollectionIntent({ version: 1, collectionId: release.collection.evidenceId, binding: input.authority.binding,
    root: input.root, checkpoint: input.checkpoint, launch: input.current.launchSettlement,
    runtime: release.runtime, begunAt: input.now });
}
function intentRelease<State extends 'finished' | 'failed'>(intent: CollectionIntent, state: State, now: number) {
  return Object.freeze({ authority: 'supervisor' as const,
    key: Object.freeze({ organizationId: intent.binding.organizationId, workspaceId: intent.binding.workspaceId,
      attemptId: intent.binding.attemptId, generation: intent.binding.generation }),
    createToken: intent.launch.createToken, specDigest: intent.binding.specDigest, runtimeId: intent.launch.runtimeId,
    runtime: intent.runtime, collection: Object.freeze({ state, observedAt: now, evidenceId: intent.collectionId }),
    launch: Object.freeze({ epoch: intent.launch.epoch, startToken: intent.launch.startToken, settlementId: intent.launch.evidenceId }) });
}
export function failedRequest(intent: CollectionIntent, now: number): FailedOutputCollection {
  return Object.freeze({ collectionId: intent.collectionId, evidence: intentRelease(intent, 'failed', now) });
}
/** Existing codecs own capture and validation; preserve the complete successful custody envelope. */
export function collectedRequest(intent: CollectionIntent, outcome: Extract<OutputCollectionResult, { ok: true }>, now: number):
  { request: CollectedSource; receipt: SourceReceipt } {
  if (!sameSourceFact(intent.root, outcome.custody.root)) throw new ControllerError('journal');
  const source = prepareOutputSource({ collectionId: intent.collectionId, binding: intent.binding,
    collection: outcome, checkpoint: intent.checkpoint, release: intentRelease(intent, 'finished', now) }, sourceHash);
  const request = Object.freeze({ collectionId: intent.collectionId, binding: source.manifest.binding,
    checkpoint: source.checkpoint, release: source.release,
    collection: Object.freeze({ ok: true as const, value: source.manifest.result, verifiedBytes: source.manifest.verifiedBytes,
      custody: Object.freeze({ resultFileBytes: source.manifest.resultFileBytes, controlBytes: source.manifest.controlBytes, root: source.root }) }) });
  return { request, receipt: receiptForOutputSource(source, sourceHash) };
}
