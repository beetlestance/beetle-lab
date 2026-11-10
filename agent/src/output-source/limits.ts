export const OUTPUT_MANIFEST_PREFIX = 'beetle-lab.output-manifest.v1\n';
export const OUTPUT_SOURCE_PREFIX = 'beetle-lab.output-source.v1\n';
export const OUTPUT_SOURCE_RESULT_BYTES = 65_536;
export const OUTPUT_MANIFEST_BYTES = 73_728;
export const OUTPUT_SOURCE_BYTES = 131_072;
export const OUTPUT_SOURCE_RECEIPT_BYTES = 1024;
export const OUTPUT_COLLECTION_INTENT_BYTES = 32_768;
export const OUTPUT_SOURCE_ROW_OVERHEAD = 256;

export type OutputSourceErrorCode = 'invalid_input' | 'integrity' | 'digest_failed';
export class OutputSourceError extends Error {
  constructor(readonly code: OutputSourceErrorCode) { super(`Output source ${code}`); }
}
