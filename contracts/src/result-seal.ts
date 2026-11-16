import { createResultSealer } from './result-seal-core.js';
import { validate } from './validate.js';
export type { ResultDigest, ResultSeal } from './result-seal-core.js';
export const resultSealPrefix = 'beetle-lab.engine-result.v1\n';
const engine = createResultSealer({prefix: resultSealPrefix, maximumBytes: 1_048_576, decode(input: unknown) {
  const checked = validate('EngineResult', input); if (!checked.ok) throw new Error('Invalid result'); return checked.value;
}});
export const sealEngineResult = engine.seal;
export const verifyEngineResultSeal = engine.verify;
export const engineResultSealPreimage = engine.preimage;
