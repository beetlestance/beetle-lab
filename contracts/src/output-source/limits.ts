export const OUTPUT_MANIFEST_PREFIX = 'beetle-lab.output-manifest.v1\n';
export const OUTPUT_SOURCE_RESULT_BYTES = 65_536;
export const OUTPUT_MANIFEST_BYTES = 73_728;

export type OutputSourceErrorCode = 'invalid_input' | 'integrity' | 'digest_failed';
export class OutputSourceError extends Error {
  constructor(readonly code: OutputSourceErrorCode) { super(`Output source ${code}`); }
}
