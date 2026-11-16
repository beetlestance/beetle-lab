import { gateFor } from '../producer-gate/fixtures.js';
import { lstat, writeFile } from 'node:fs/promises';
import type { ControlEvent, Offer } from '@beetle/contracts';
import { captureCollectionIntent } from '../../src/output-source/index.js';
import type { CollectedSource, SourceBinding } from '../../src/output-source/index.js';
import type { Journal } from '../../src/journal/index.js';
import { CONTROL_FILE } from '../../src/control-protocol/index.js';
import { createOutputSourceReader } from '../../src/output-transfer/index.js';
import { readOutputRange } from '../../src/collection/output/index.js';
import { admissionFixture, configuration, observation, now, reserved, scope } from '../admission/fixtures.js';
import { fixture as outputFixture, seal, sha } from '../output-collection/fixture.js';

const specDigest = 'c'.repeat(64);
function binary(): Buffer {
  const bytes = Buffer.alloc(131_089);
  for (let index = 0; index < bytes.length; index++) bytes[index] = (index * 73 + 19) % 256;
  return bytes;
}
async function collectFiles(files: ReturnType<typeof outputFixture>, offer: Offer) {
  const bytes = binary(); const artifacts = [await files.artifact('reports/binary.bin', bytes),
    await files.artifact('reports/empty.bin', Buffer.alloc(0))];
  const key = scope(offer); const result = seal({ ...files.result(artifacts), ...key });
  await files.write(result);
  const event: ControlEvent = { version: '1.0', ...key, seq: 1, phase: 'seal', kind: 'engine.result',
    observedAt: '2026-01-01T00:00:00Z', payload: result };
  const control = Buffer.from(JSON.stringify(event) + '\n'); await writeFile(files.path(CONTROL_FILE), control, { mode: 0o600 });
  const controlStat = await lstat(files.path(CONTROL_FILE), { bigint: true });
  const operation = files.collect(files.options(result, { controlBytes: Number(controlStat.size), outputBytes: offer.budget.outputBytes }));
  const collection = await operation.result; await operation.quiesced; await operation.close();
  if (!collection.ok) throw new Error(`Actual collection failed: ${collection.reason}`);
  return { bytes, result, control, controlStat, collection, artifacts, event };
}
/** Synthetic stopped-runtime evidence; every admission/claim/source transition is actual Journal work. */
async function stopped(journal: Journal, key: ReturnType<typeof scope>) {
  const claim = await journal.admission({ kind: 'claimCreate', key, specDigest });
  if (!('token' in claim)) throw new Error('Missing actual create claim');
  const binding = { key, createToken: claim.token, specDigest, runtimeId: 'synthetic-composed-source-runtime' };
  await journal.admission({ kind: 'bindRuntime', ...binding });
  const launch = { authority: 'supervisor' as const, ...binding, epoch: 0 as const, startToken: null,
    disposition: 'retired' as const, settledAt: now + 2, evidenceId: 'synthetic-composed-source-settlement' };
  await journal.admission({ kind: 'settleLaunch', settlement: launch });
  const runtime = { state: 'stopped' as const, source: 'supervisor' as const, observedAt: now + 3, evidenceId: 'synthetic-composed-source-stop' };
  return { binding, launch, runtime };
}
export function sourceFixture() {
  const f = admissionFixture(); const files = outputFixture();
  async function prepare() {
    const path = f.path(); const journal = await f.configured(path); const offer = f.job(2); offer.budget.outputBytes = 200_000;
    const config = configuration(); config.pool.outputBytes = 400_000; config.perRun.outputBytes = 400_000;
    const observed = observation(now + 1); observed.capacity.outputBytes = 400_000;
    await journal.admission({ kind: 'configure', configuration: config }); await journal.admission({ kind: 'observe', observation: observed });
    await f.enqueue(journal, offer, now + 1); reserved(await f.admit(journal, offer, now + 1));
    const key = scope(offer); const evidence = await stopped(journal, key); const collected = await collectFiles(files, offer);
    const checkpoint = await journal.commitWrapperBatch({ key, expected: null, events: [collected.event], next: {
      version: 1, dev: collected.controlStat.dev.toString(), ino: collected.controlStat.ino.toString(), offset: collected.collection.custody.controlBytes,
      wrapperSeq: 1, prefixSha256: sha(collected.control) } });
    const collectionId = '00000000-0000-4000-8000-000000000080';
    const binding: SourceBinding = { ...key, generation: 1, journalAuthority: await journal.journalAuthority(),
      intentDigest: offer.intentDigest, engine: offer.engine, installedIdentity: offer.installedIdentity, specDigest };
    const release = { authority: 'supervisor' as const, ...evidence.binding, runtime: evidence.runtime,
      collection: { state: 'finished' as const, observedAt: now + 5, evidenceId: collectionId },
      launch: { epoch: 0 as const, startToken: null, settlementId: evidence.launch.evidenceId } };
    const intent = captureCollectionIntent({ version: 1, collectionId, binding, root: collected.collection.custody.root,
      checkpoint, launch: evidence.launch, runtime: evidence.runtime, begunAt: now + 4 });
    await journal.beginOutputCollection(intent);
    const source: CollectedSource = { collectionId, binding, collection: collected.collection, checkpoint, release };
    const receipt = await journal.commitOutputSource(source); const released = await journal.releaseOutputSource(receipt);
    const closure = await journal.closeOutputDelivery(receipt);
    const reader = createOutputSourceReader({ journal, gate: gateFor(journal), readRange: readOutputRange });
    return { ...collected, journal, path, key, offer, intent, receipt, released, closure, reader, files };
  }
  return { ...f, prepare };
}
