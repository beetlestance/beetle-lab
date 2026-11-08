import { constants } from 'node:fs';
import { access, lstat, realpath } from 'node:fs/promises';
import { join } from 'node:path';
import { UnixDockerTransport } from '../backends/docker/index.js';
import { openInstalledProviders, readPrivateFile } from '../providers/index.js';
import type { InstalledProviders } from '../providers/index.js';
import { absolutePath, installedConfiguration } from './installed-config.js';
import { AgentConfigurationError } from './configuration-types.js';
import type { AgentEnvironment, LoadedAgentConfiguration } from './configuration-types.js';

function check(signal: AbortSignal | undefined): void { if (signal?.aborted) throw new AgentConfigurationError(); }
async function journalDirectory(path: string): Promise<string> {
  const info = await lstat(path);
  if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077) !== 0 || await realpath(path) !== path) {
    throw new AgentConfigurationError();
  }
  await access(path, constants.R_OK | constants.W_OK | constants.X_OK);
  return path;
}
function configPath(environment: AgentEnvironment): string {
  const descriptor = Object.getOwnPropertyDescriptor(environment, 'BEETLE_AGENT_CONFIG_FILE');
  if (!descriptor || !('value' in descriptor)) throw new AgentConfigurationError();
  return absolutePath(descriptor.value);
}
/** Private installation files only. No env interpolation, guessed images/capacity or secret defaults. */
export async function loadAgentConfiguration(environment: AgentEnvironment, workerUrl: URL,
  signal?: AbortSignal): Promise<LoadedAgentConfiguration> {
  let providers: InstalledProviders | undefined;
  try {
    check(signal);
    const content = await readPrivateFile(configPath(environment), 262_144, signal); check(signal);
    const config = installedConfiguration(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(content)) as unknown);
    const directory = await journalDirectory(config.journalDirectory); check(signal);
    const raw = await readPrivateFile(config.credentialFile, 128, signal); check(signal);
    const credential = new TextDecoder('utf-8', { fatal: true }).decode(raw); raw.fill(0);
    if (!/^[A-Za-z0-9_-]{43,128}$/u.test(credential)) throw new AgentConfigurationError();
    providers = await openInstalledProviders({ configuration: config.providers, environment }); check(signal);
    const owned = providers;
    return Object.freeze({ runtime: { journal: { path: join(directory, 'journal.sqlite'), workerUrl },
      installation: config.installation, transport: new UnixDockerTransport(config.dockerSocket), catalog: config.catalog,
      configuration: config.configuration, providers: owned, credential, minimumFreeBytes: config.minimumFreeBytes,
      ...(signal ? { signal } : {}) }, listen: Object.freeze(config.listen), close: () => owned.close() });
  } catch {
    await providers?.close();
    throw new AgentConfigurationError();
  }
}
