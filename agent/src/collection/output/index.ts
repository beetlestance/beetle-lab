export { OUTPUT_RESULT_FILE, OUTPUT_RESULT_BYTES, OUTPUT_READ_BYTES, OUTPUT_COLLECTION_MAX_MS, OUTPUT_CUSTODY_BYTES } from './types.js';
export type { OutputCollectionReason, OutputCollectionOptions, OutputCollectionResult, OutputRootIdentity, OutputCustody,
  OutputCollection, OutputCollector } from './types.js';
export type { OutputRangeOptions, OutputRangeResult, OutputRange, OutputRangeReader } from './range-types.js';
import { startCollection } from './operation.js';
import type { OutputCollectionOptions, OutputCollection } from './types.js';
export { readOutputRange } from './range.js';
export function collectOutputs(options: OutputCollectionOptions): OutputCollection { return startCollection(options); }
