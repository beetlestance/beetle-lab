import { sealEngineResult } from '@beetle/contracts';
import { captureCollectionIntent } from '../../src/output-source/index.js';
import { hash } from '../source-journal/fixtures.js';
import type { sourceFixture } from '../source-journal/fixtures.js';
import { now, reserved, scope, configuration, observation } from '../admission/fixtures.js';

type Fixture = ReturnType<typeof sourceFixture>;
type Seed = Awaited<ReturnType<Fixture['seed']>>;
/** Synthetic capacity covers retained history; Manager's real 64-owner cap is unchanged. */
export async function historyCapacity(e: Seed): Promise<void> {
  const config = configuration(); config.pool.outputBytes = 10_000_000; config.perRun.outputBytes = 200_000;
  config.pool.stagingBytes = 1_000_000_000;
  const observed = observation(now + 2); observed.capacity.outputBytes = 10_000_000;
  observed.capacity.stagingBytes = 1_000_000_000; observed.freeDiskBytes = 2_000_000_000;
  await e.journal.admission({ kind: 'configure', configuration: config });
  await e.journal.admission({ kind: 'observe', observation: observed });
}
/** Actual Journal transitions; the template's source/native metadata is synthetic. */
export async function closedHistory(f: Fixture, e: Seed, index: number) {
  const offer = structuredClone(e.offer); offer.attemptId = `00000000-0000-4000-8000-${index.toString().padStart(12, '0')}`;
  const journal = e.journal; const key = scope(offer); const draft = structuredClone(e.collected);
  await f.enqueue(journal, offer, now + 2); reserved(await f.admit(journal, offer, now + 2));
  const claim = await journal.admission({ kind: 'claimCreate', key, specDigest: draft.binding.specDigest });
  if (!('token' in claim)) throw new Error('Missing actual claim');
  const binding = { key, createToken: claim.token, specDigest: draft.binding.specDigest, runtimeId: `synthetic-history-${index}` };
  await journal.admission({ kind: 'bindRuntime', ...binding });
  const launch = { authority: 'supervisor' as const, ...binding, epoch: 0 as const, startToken: null,
    disposition: 'retired' as const, settledAt: now + 2, evidenceId: `synthetic-history-settlement-${index}` };
  await journal.admission({ kind: 'settleLaunch', settlement: launch });
  draft.binding = { ...draft.binding, ...key, generation: 1 }; draft.collectionId = `00000000-0000-4000-8000-${(1000 + index).toString().padStart(12, '0')}`;
  const { seal, ...body } = { ...draft.collection.value, ...key };
  const sealed = sealEngineResult(body, seal.sealedAt, hash); if (!sealed.ok) throw new Error('Invalid synthetic result');
  draft.collection.value = structuredClone(sealed.value);
  const event = { ...key, version: '1.0' as const, seq: 1, phase: 'seal' as const, kind: 'engine.result' as const,
    observedAt: '2026-01-01T00:00:00Z', payload: sealed.value };
  const raw = JSON.stringify(event) + '\n';
  const checkpoint = await journal.commitWrapperBatch({ key, expected: null, events: [event], next: {
    version: 1, dev: draft.collection.custody.root.device, ino: draft.checkpoint.ino,
    offset: Buffer.byteLength(raw), wrapperSeq: 1, prefixSha256: hash(raw) } });
  draft.checkpoint = checkpoint; draft.collection.custody.controlBytes = checkpoint.offset;
  draft.collection.verifiedBytes = draft.collection.custody.resultFileBytes + checkpoint.offset
    + draft.collection.value.artifacts.reduce((sum, artifact) => sum + artifact.bytes, 0);
  draft.release = { ...draft.release, ...binding, collection: { ...draft.release.collection, evidenceId: draft.collectionId }, launch: { epoch: 0, startToken: null, settlementId: launch.evidenceId } };
  await journal.beginOutputCollection(captureCollectionIntent({ ...e.intent, collectionId: draft.collectionId,
    binding: draft.binding, checkpoint, launch, runtime: draft.release.runtime }));
  const receipt = await journal.commitOutputSource(draft); await journal.releaseOutputSource(receipt);
  const closure = await journal.closeOutputDelivery(receipt);
  return { key, offer, closure };
}
