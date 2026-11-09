import { loadAgentConfiguration } from './agent-configuration.js';
import { constants } from 'node:fs';
import { access, open, realpath, stat } from 'node:fs/promises';
import type { FileHandle } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { validateApi } from '@beetle/contracts/api';
import type { InstallationRecord } from '../domain/settings/index.js';
import type { ApplicationOptions } from './api.js';

export class BootstrapError extends Error {
  constructor(readonly code: 'configuration' | 'data_directory' | 'listener', options?: ErrorOptions) {
    super('Backend startup failed', options); this.name = 'BootstrapError';
  }
}
export interface BackendEnvironment {
  readonly BEETLE_CONFIG_FILE?: string;
  readonly BEETLE_AGENT_CONFIG_FILE?: string;
  readonly BEETLE_DATA_DIR?: string;
  readonly BEETLE_EXTERNAL_ORIGIN?: string;
  readonly BEETLE_LISTEN_HOST?: string;
  readonly BEETLE_LISTEN_PORT?: string;
}
export interface BackendConfiguration {
  readonly application: ApplicationOptions;
  readonly listen: Readonly<{ host: string; port: number }>;
}
function absolute(value: string | undefined): string {
  if (!value || value.length > 4096 || !isAbsolute(value)) throw new BootstrapError('configuration');
  return resolve(value);
}
function installation(value: unknown): InstallationRecord {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new BootstrapError('configuration');
  const record = value as Record<string, unknown>;
  if (Object.keys(record).some(key => !['id', 'version', 'schemaVersion', 'scope', 'values'].includes(key))
    || record.version !== 1 || record.schemaVersion !== 2 || !validateApi('Uuid', record.id).ok
    || !validateApi('InstallationScope', record.scope).ok || !validateApi('InstallationValues', record.values).ok) {
    throw new BootstrapError('configuration');
  }
  return record as unknown as InstallationRecord;
}
async function readInstallation(path: string): Promise<InstallationRecord> {
  try {
    const handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    let value: unknown;
    try {
      const info = await handle.stat();
      if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 32_768 || (info.mode & 0o022)) throw new BootstrapError('configuration');
      value = JSON.parse(await boundedText(handle)) as unknown;
    } finally { await handle.close(); }
    return installation(value);
  } catch { throw new BootstrapError('configuration'); }
}
async function boundedText(handle: FileHandle): Promise<string> {
  const buffer = new Uint8Array(32_769);
  let size = 0;
  for (let calls = 0; calls < 64; calls++) {
    const read = await handle.read(buffer, size, buffer.byteLength - size, size);
    size += read.bytesRead;
    if (size > 32_768) throw new BootstrapError('configuration');
    if (read.bytesRead === 0) return new TextDecoder('utf-8', { fatal: true }).decode(buffer.subarray(0, size));
  }
  throw new BootstrapError('configuration');
}
async function dataDirectory(path: string): Promise<string> {
  try {
    const canonical = await realpath(path);
    const info = await stat(canonical);
    if (!info.isDirectory() || info.uid !== process.getuid?.() || (info.mode & 0o077)) throw new BootstrapError('data_directory');
    await access(canonical, constants.R_OK | constants.W_OK | constants.X_OK);
    return canonical;
  } catch { throw new BootstrapError('data_directory'); }
}
function listener(environment: BackendEnvironment): BackendConfiguration['listen'] {
  const host = environment.BEETLE_LISTEN_HOST ?? '127.0.0.1';
  const text = environment.BEETLE_LISTEN_PORT ?? '4311';
  if (!['127.0.0.1', '::1', '0.0.0.0'].includes(host) || !/^[1-9][0-9]{0,4}$/.test(text)) throw new BootstrapError('listener');
  const port = Number(text);
  if (port > 65535) throw new BootstrapError('listener');
  return Object.freeze({ host, port });
}
async function agentConnection(path: string, installationId: string) {
  try { return await loadAgentConfiguration(path, installationId); }
  catch (error) { throw new BootstrapError('configuration', { cause: error }); }
}
/** Installation-owned config and private existing data root only. No guessed
 * machine capacity: actual source observations are published after startup.
 */
export async function loadBackendConfiguration(environment: BackendEnvironment, workerUrl: URL): Promise<BackendConfiguration> {
  const listen = listener(environment);
  const config = absolute(environment.BEETLE_CONFIG_FILE);
  const agentConfig = absolute(environment.BEETLE_AGENT_CONFIG_FILE);
  const root = absolute(environment.BEETLE_DATA_DIR);
  const externalOrigin = environment.BEETLE_EXTERNAL_ORIGIN;
  if (!externalOrigin || externalOrigin.length > 2048) throw new BootstrapError('configuration');
  const record = await readInstallation(config);
  const directory = await dataDirectory(root);
  const connection = await agentConnection(agentConfig, record.id);
  return Object.freeze({ listen, application: { externalOrigin,
    inputsDirectory: join(directory, 'inputs'), agent: { connection, dataRoot: directory },
    metadata: { path: join(directory, 'metadata.sqlite'), workerUrl, installation: record, runtime: null } } });
}
