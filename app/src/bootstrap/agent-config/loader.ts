import type { LoadedAgentConfiguration } from '../../ports/runner.js';
import { AgentConfigurationError } from './error.js';
import { PrivateFileReader } from './private-file.js';
import type { FileOperations } from './private-file.js';
import { configuration, token } from './validation.js';

/** Internal construction seam; each loader owns one bounded original file intake. */
export function createAgentConfigurationLoader(files: FileOperations) {
  const reader = new PrivateFileReader(files);
  let active = false;
  return async (path: string, installationId: string): Promise<LoadedAgentConfiguration> => {
    if (active || reader.failed) throw new AgentConfigurationError();
    active = true;
    try {
      const bytes = await reader.read(path, 65_536);
      let input: unknown;
      try { input = JSON.parse(new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes)) as unknown; }
      finally { bytes.fill(0); }
      const captured = configuration(input, installationId);
      const credential = await reader.read(captured.tokenFile, 129);
      try { return Object.freeze({ configuration: captured, token: token(credential) }); }
      finally { credential.fill(0); }
    } catch { throw new AgentConfigurationError(); }
    finally { active = false; }
  };
}
