import { verifySourceChunk } from '@beetle/contracts/output-source';
import type { SourceChunkRequest } from '@beetle/contracts/output-source';
import type { OutputArtifactKey } from '../../ports/output-artifacts.js';
import type { OutputFileRecord, OutputFileReceipt } from '../../ports/output-bytes.js';
import { OUTPUT_CHUNK_BYTES } from '../../ports/output-bytes.js';
import type { OutputTransferOptions } from '../../ports/output-transfer.js';
import type { TransferOwner } from './ownership.js';
import { client, sourceReply } from './source.js';
import { record, receipt, uuid } from './validation.js';
import { fail, requireTransfer as check } from './errors.js';

interface ArtifactTransfer {
  options: OutputTransferOptions;
  owner: TransferOwner;
  key: OutputArtifactKey;
  clock: () => number;
}
function request(transfer: ArtifactTransfer, value: OutputFileRecord) {
  check(value.artifact.writer !== null);
  return {key: transfer.key, writerId: value.artifact.writer, expectedVersion: value.artifact.version};
}
function context(transfer: ArtifactTransfer) {
  return transfer.owner.context(transfer.options.freeSpaceReserveBytes, transfer.clock);
}
function newWriter(transfer: ArtifactTransfer): string {
  transfer.owner.check(); let writerId: string;
  try { writerId = transfer.options.newWriterId(); } catch { fail('invalid_input'); }
  check(uuid(writerId), 'invalid_input'); return writerId;
}
async function progress(transfer: ArtifactTransfer, value: OutputFileRecord, native: OutputFileReceipt): Promise<OutputFileRecord> {
  const next = record(await transfer.owner.call(() => transfer.options.metadata.recordProgress({
    ...request(transfer, value), receipt: native})), value);
  check(next.artifact.phase === 'transferring' && next.artifact.writer === value.artifact.writer);
  check(next.artifact.offset === native.offset && next.artifact.identity === native.identity); return next;
}
async function appendChunks(transfer: ArtifactTransfer, input: OutputFileRecord): Promise<OutputFileRecord> {
  let value = input; const {options, owner, key} = transfer;
  const output = client(options, owner, value.binding);
  while (value.artifact.offset < value.artifact.bytes) {
    owner.check(); const offset = value.artifact.offset;
    const selector: SourceChunkRequest = {version: 1, manifestDigest: key.manifestDigest, sourceDigest: key.sourceDigest,
      artifactId: value.artifact.artifactId, offset, length: Math.min(OUTPUT_CHUNK_BYTES, value.artifact.bytes - offset)};
    const response = await owner.call(() => output.sourceChunk(selector, value.artifact.bytes, owner.controller.signal));
    const received = sourceReply(response, value.binding); check(received !== null);
    const chunk = verifySourceChunk(received, selector, value.artifact.bytes);
    owner.check(); const bytes = Uint8Array.from(atob(chunk.base64), character => character.charCodeAt(0));
    const current = value; const policy = context(transfer);
    const native = receipt(await owner.file(() => options.files.append({record: current, offset, bytes}, policy)), current, false);
    check(native.offset === chunk.nextOffset);
    value = await progress(transfer, value, native);
  }
  return value;
}
async function publish(transfer: ArtifactTransfer, value: OutputFileRecord): Promise<OutputFileRecord> {
  const {owner, options} = transfer;
  // The serial producer has left appendChunks permanently before publication.
  const policy = context(transfer);
  const native = receipt(await owner.file(() => options.files.publish(value, policy)), value, true);
  const next = record(await owner.call(() => options.metadata.recordPublication({...request(transfer, value), receipt: native})), value);
  check(next.artifact.phase === 'published' && next.artifact.writer === null);
  check(next.artifact.offset === native.offset && next.artifact.identity === native.identity); return next;
}
export async function transferArtifact(transfer: ArtifactTransfer, input: OutputFileRecord): Promise<void> {
  const {options, owner} = transfer; let value = input;
  if (value.artifact.phase === 'published') {
    const policy = context(transfer);
    const native = receipt(await owner.file(() => options.files.prepare(value, policy)), value, true);
    check(native.identity === value.artifact.identity); return;
  }
  if (value.artifact.writer === null) {
    const writerId = newWriter(transfer);
    value = record(await owner.call(() => options.metadata.claimArtifact({key: transfer.key, writerId,
      expectedVersion: input.artifact.version})), input);
    check(value.artifact.writer === writerId && value.artifact.phase === 'transferring');
  }
  if (value.artifact.phase === 'transferring') {
    const current = value; const policy = context(transfer);
    const native = receipt(await owner.file(() => options.files.prepare(current, policy)), current, false);
    value = await progress(transfer, value, native);
    if (value.artifact.offset < value.artifact.bytes) value = await appendChunks(transfer, value);
    const full = value;
    value = record(await owner.call(() => options.metadata.beginPublication(request(transfer, full))), full);
    check(value.artifact.phase === 'publishing' && value.artifact.writer === full.artifact.writer);
    check(value.artifact.identity === full.artifact.identity && value.artifact.offset === full.artifact.bytes);
  }
  await publish(transfer, value);
}
