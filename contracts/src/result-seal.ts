import { createResultSealer } from './result-seal-core.js';
import type { Artifact, EngineResult } from './generated/types.js';
import { validate } from './validate.js';
export type { ResultDigest, ResultSeal } from './result-seal-core.js';
export const resultSealPrefix = 'beetle-lab.engine-result.v1\n';
const engine = createResultSealer({
  prefix: resultSealPrefix,
  maximumBytes: 1_048_576,
  decode(input: unknown) {
    const checked = validate('EngineResult', input);
    if (!checked.ok) throw new Error('Invalid result');
    verifyNativeOverview(checked.value);
    return checked.value;
  },
});
export const sealEngineResult = engine.seal;
export const verifyEngineResultSeal = engine.verify;
export const engineResultSealPreimage = engine.preimage;

function verifyNativeOverview(result: EngineResult): void {
  if (!result.nativeOverview) return;
  const sources = result.artifacts.filter((artifact) => artifact.kind === 'native-summary');
  const source = sources[0];
  if (
    result.engineId !== 'k6' ||
    result.execution.status !== 'error' ||
    result.execution.reason !== 'artifact_incomplete' ||
    result.completeness !== 'partial' ||
    result.artifacts.some((artifact) => artifact.kind === 'metric-windows' || artifact.kind === 'metric-index')
  )
    throw new Error('Invalid native summary provenance');
  if (sources.length !== 1 || !matchesNativeArtifact(source, result.nativeOverview.summarySha256))
    throw new Error('Invalid native summary artifact');
}

function matchesNativeArtifact(source: Artifact | undefined, sha256: string): boolean {
  return (
    !!source &&
    source.relativePath === 'beetle-evidence.json' &&
    source.bytes >= 1 &&
    source.bytes <= 1_048_576 &&
    source.sha256 === sha256
  );
}
