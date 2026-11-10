import { capture, canonical, checked, fields, freeze, requireInput } from './capture.js';
import { binding, checkpoint, integer, launch, root, runtime, uuid } from './shape.js';
import { OUTPUT_COLLECTION_INTENT_BYTES } from './limits.js';
import type { CaptureCollectionIntent } from './types.js';

/** Capture data only; native custody and durable intent authority remain external. */
export const captureCollectionIntent: CaptureCollectionIntent = input => checked(() => {
  const value = fields(capture(input, OUTPUT_COLLECTION_INTENT_BYTES), 'version,collectionId,binding,root,checkpoint,launch,runtime,begunAt');
  requireInput(value.version === 1); uuid(value.collectionId); integer(value.begunAt);
  const original = binding(value.binding); const identity = root(value.root); const cursor = checkpoint(value.checkpoint);
  const settled = launch(value.launch, original); const stopped = runtime(value.runtime);
  requireInput(cursor.dev === identity.device);
  requireInput(value.begunAt >= stopped.observedAt && stopped.observedAt > settled.settledAt);
  const intent = { version: 1 as const, collectionId: value.collectionId, binding: original, root: identity,
    checkpoint: cursor, launch: settled, runtime: stopped, begunAt: value.begunAt };
  canonical(intent, OUTPUT_COLLECTION_INTENT_BYTES); return freeze(intent);
});
