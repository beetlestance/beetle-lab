import type { LoadedAgentConfiguration } from '../ports/runner.js';
import { createAgentConfigurationLoader } from './agent-config/loader.js';
import { nativeFiles } from './agent-config/private-file.js';

const load = createAgentConfigurationLoader(nativeFiles);
/** Captures private installation pins and token once; no environment/network/store effects.
 * Reads and closes settle before return. Failed close rejects and permanently fences intake.
 */
export function loadAgentConfiguration(path: string, installationId: string): Promise<LoadedAgentConfiguration> {
  return load(path, installationId);
}
