export { OUTPUT_RESULT_FILE, OUTPUT_RESULT_BYTES, OUTPUT_READ_BYTES, OUTPUT_COLLECTION_MAX_MS } from './types.js';
export type { OutputCollectionReason, OutputCollectionOptions, OutputCollectionResult,
  OutputCollection, OutputCollector } from './types.js';
import { startCollection } from './operation.js';
import type { OutputCollectionOptions, OutputCollection } from './types.js';
export function collectOutputs(options: OutputCollectionOptions): OutputCollection { return startCollection(options); }
