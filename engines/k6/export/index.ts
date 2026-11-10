import { buildRuntimeScript } from '../build/index.js';
import { captureOptions } from './options.js';
import { StandaloneExportError } from './types.js';
import type { ExportStandaloneScript } from './types.js';
export { StandaloneExportError } from './types.js';
export type { StandaloneExportInput, StandaloneExportOutput, StandaloneExportCode, ExportStandaloneScript } from './types.js';

/** One existing standalone build; never resolves secrets or publishes partial output. */
export const exportStandaloneScript: ExportStandaloneScript = async input => {
  const captured = captureOptions(input);
  if (captured.suite.identity.secrets.length !== 0) throw new StandaloneExportError('unsupported_secrets');
  try {
    const output = await buildRuntimeScript(captured);
    return Object.freeze({ scriptPath: output.scriptPath, bytes: output.bytes, peakBytes: output.peakBytes });
  } catch { throw new StandaloneExportError('build_failed'); }
};
