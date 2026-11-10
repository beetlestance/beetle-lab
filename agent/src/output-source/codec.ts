import { prepareOutputManifest, verifyOutputManifest } from '@beetle/contracts/output-source';
import { digest, publicCore } from '@beetle/contracts/output-source/internal';
import { capture, canonical, checked, fields, freeze, requireInput } from './capture.js';
import { binding, checkpoint, release, root, sha, uuid } from './shape.js';
import { OUTPUT_MANIFEST_BYTES, OUTPUT_SOURCE_BYTES, OUTPUT_SOURCE_PREFIX,
  OUTPUT_SOURCE_RECEIPT_BYTES, OutputSourceError } from './limits.js';
import type { PrepareOutputSource, VerifyOutputSource, ReceiptForOutputSource, PublicCore, PrivateCore, PrivateSource } from './types.js';

function privateCore(input: unknown): PrivateCore {
  const value = fields(input, 'version,manifest,root,checkpoint,release,sourceDigest');
  requireInput(value.version === 1);
  const manifest = fields(value.manifest, 'version,binding,result,resultFileBytes,controlBytes,verifiedBytes,manifestDigest');
  const core = publicCore(manifest, true); sha(manifest.manifestDigest); sha(value.sourceDigest);
  canonical(manifest, OUTPUT_MANIFEST_BYTES);
  const identity = root(value.root); const cursor = checkpoint(value.checkpoint);
  requireInput(cursor.offset === core.controlBytes && cursor.dev === identity.device);
  return { version: 1, manifest: { ...core, manifestDigest: manifest.manifestDigest }, root: identity,
    checkpoint: cursor, release: release(value.release, core.binding) };
}
function collected(input: unknown): { public: PublicCore; private: Omit<PrivateCore, 'version' | 'manifest'> } {
  const value = fields(input, 'collectionId,binding,collection,checkpoint,release'); uuid(value.collectionId);
  const original = binding(value.binding);
  const collection = fields(value.collection, 'ok,value,verifiedBytes,custody'); requireInput(collection.ok === true);
  const custody = fields(collection.custody, 'resultFileBytes,controlBytes,root'); canonical(custody, 32_768);
  const core = publicCore({ version: 1, binding: original, result: collection.value, resultFileBytes: custody.resultFileBytes,
    controlBytes: custody.controlBytes, verifiedBytes: collection.verifiedBytes }, false);
  const identity = root(custody.root); const cursor = checkpoint(value.checkpoint);
  requireInput(cursor.offset === core.controlBytes && cursor.dev === identity.device);
  const evidence = release(value.release, original); requireInput(evidence.collection.evidenceId === value.collectionId);
  return { public: core, private: { root: identity, checkpoint: cursor, release: evidence } };
}
/** Pure content preparation; native custody and original admission remain separate. */
export const prepareOutputSource: PrepareOutputSource = (input, provider) => checked(() => {
  const value = collected(capture(input, OUTPUT_SOURCE_BYTES));
  const manifest = prepareOutputManifest(value.public, provider);
  const core: PrivateCore = { version: 1, manifest, ...value.private };
  const sourceDigest = digest(OUTPUT_SOURCE_PREFIX + canonical(core, OUTPUT_SOURCE_BYTES), provider);
  const source = { ...core, sourceDigest }; canonical(source, OUTPUT_SOURCE_BYTES);
  return freeze(source);
});
/** Check the complete private envelope, result seal and both content digests. */
export const verifyOutputSource: VerifyOutputSource = (input, provider) => checked(() => {
  const value = capture(input, OUTPUT_SOURCE_BYTES) as PrivateSource;
  const captured = privateCore(value);
  const core: PrivateCore = { ...captured, manifest: verifyOutputManifest(captured.manifest, provider) };
  if (digest(OUTPUT_SOURCE_PREFIX + canonical(core, OUTPUT_SOURCE_BYTES), provider) !== value.sourceDigest) throw new OutputSourceError('integrity');
  return freeze({ ...core, sourceDigest: value.sourceDigest });
});
/** Extraction never grants authority to an unchecked digest or scope. */
export const receiptForOutputSource: ReceiptForOutputSource = (input, provider) => {
  const value = verifyOutputSource(input, provider); const original = value.manifest.binding;
  const receipt = { version: 1 as const, journalAuthority: original.journalAuthority,
    key: { organizationId: original.organizationId, workspaceId: original.workspaceId, attemptId: original.attemptId, generation: 1 as const },
    manifestDigest: value.manifest.manifestDigest, sourceDigest: value.sourceDigest };
  canonical(receipt, OUTPUT_SOURCE_RECEIPT_BYTES); return freeze(receipt);
};
