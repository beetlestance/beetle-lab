import { verifyExecutionResultSeal } from '../execution-result.js';
import type { ResultDigest } from '../result-seal.js';
import type { ExecutionResult } from '../generated/types.js';
import { capture, canonical, checked, fields, freeze } from './capture.js';
import { publicCore, sha } from './shape.js';
import { OUTPUT_MANIFEST_BYTES, OUTPUT_MANIFEST_PREFIX, OutputSourceError } from './limits.js';
import type { PrepareOutputManifest, VerifyOutputManifest } from './types.js';

export function digest(text: string, provider: ResultDigest): string {
  try {
    const value = provider(text);
    if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new Error('Invalid digest');
    return value;
  } catch { throw new OutputSourceError('digest_failed'); }
}
function seal(value: ExecutionResult, provider: ResultDigest): void {
  const verified = verifyExecutionResultSeal(value, provider);
  if (!verified.ok) {
    const codes = { invalid_result: 'invalid_input', digest_failed: 'digest_failed', seal_mismatch: 'integrity' } as const;
    throw new OutputSourceError(codes[verified.code]);
  }
}
/** Pure content value; this proves no native files, execution or durable authority. */
export const prepareOutputManifest: PrepareOutputManifest = (input, provider) => checked(() => {
  const core = publicCore(capture(input, OUTPUT_MANIFEST_BYTES), false);
  seal(core.result as ExecutionResult, provider);
  const manifestDigest = digest(OUTPUT_MANIFEST_PREFIX + canonical(core, OUTPUT_MANIFEST_BYTES), provider);
  const manifest = { ...core, manifestDigest }; canonical(manifest, OUTPUT_MANIFEST_BYTES); return freeze(manifest);
});
export const verifyOutputManifest: VerifyOutputManifest = (input, provider) => checked(() => {
  const value = fields(capture(input, OUTPUT_MANIFEST_BYTES), 'version,binding,result,resultFileBytes,controlBytes,verifiedBytes,manifestDigest');
  const core = publicCore(value, true); sha(value.manifestDigest);
  seal(core.result as ExecutionResult, provider);
  if (digest(OUTPUT_MANIFEST_PREFIX + canonical(core, OUTPUT_MANIFEST_BYTES), provider) !== value.manifestDigest) throw new OutputSourceError('integrity');
  return freeze({ ...core, manifestDigest: value.manifestDigest });
});
