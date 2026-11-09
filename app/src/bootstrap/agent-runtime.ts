import { dirname, isAbsolute, join, normalize } from 'node:path';
import { encodeJson } from '@beetle/contracts';
import { immutableSnapshot, requireRule } from '../domain/namespaces/index.js';
import type { LoadedAgentConfiguration, RunnerGateway } from '../ports/runner.js';
import type { CapacitySource } from '../ports/runtime.js';
import { createRunnerGateway } from '../adapters/outbound/runner/index.js';
import { openCapacitySource } from '../adapters/outbound/capacity/index.js';
import type { Metadata, MetadataOptions } from '../adapters/outbound/sqlite/index.js';
import { startRuntimePoller } from './runtime-poller.js';
import type { RuntimePollerState } from './runtime-poller.js';
import { createRuntimePublisher } from './runtime-publication.js';

export interface AgentRuntimeOptions {
  readonly connection: LoadedAgentConfiguration;
  readonly dataRoot: string;
}
export interface AgentRuntime {
  state(): RuntimePollerState;
  close(): Promise<void>;
}
/** Copy private values before any foreign await; storage and observation root agree. */
export function captureAgentRuntime(options: AgentRuntimeOptions, metadata: MetadataOptions,
  inputsDirectory?: string): AgentRuntimeOptions {
  const copy = JSON.parse(encodeJson(options, 131072)) as AgentRuntimeOptions;
  requireRule(copy !== null && !Array.isArray(copy) && Object.keys(copy).every(key => ['connection', 'dataRoot'].includes(key)));
  requireRule(copy.connection !== null && typeof copy.connection === 'object' && !Array.isArray(copy.connection) &&
    Object.keys(copy.connection).every(key => ['configuration', 'token'].includes(key)));
  requireRule(typeof copy.connection?.configuration?.expectedInstallationId === 'string');
  requireRule(copy.connection.configuration.expectedInstallationId === metadata.installation.id);
  checkStoragePaths(copy.dataRoot, metadata.path, inputsDirectory);
  return immutableSnapshot(copy);
}
function checkStoragePaths(root: string, metadataPath: string, inputsDirectory?: string): void {
  requireRule(typeof root === 'string' && isAbsolute(root) && normalize(root) === root);
  requireRule(dirname(metadataPath) === root);
  requireRule(inputsDirectory === undefined || inputsDirectory === join(root, 'inputs'));
}
export function agentMetadata(metadata: MetadataOptions, agent: AgentRuntimeOptions | undefined): MetadataOptions {
  if (!agent) return metadata;
  return { ...metadata, runtime: null, runs: { profiles: agent.connection.configuration.profiles,
    pendingLimit: metadata.runs?.pendingLimit ?? 256 } };
}
async function drainAgent(owner: Pick<CapacitySource, 'close'> | undefined, gateway: RunnerGateway): Promise<void> {
  const errors: unknown[] = [];
  try { await owner?.close(); } catch (error) { errors.push(error); }
  try { await gateway.close(); } catch (error) { errors.push(error); }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Agent runtime shutdown failed');
}
/** Poller owns source; shared gateway closes only after original publication drains. */
export async function openAgentRuntime(options: AgentRuntimeOptions, metadata: Metadata): Promise<AgentRuntime> {
  const gateway = createRunnerGateway(options.connection);
  let source: CapacitySource | undefined;
  try {
    source = await openCapacitySource({ dataRoot: options.dataRoot, configuration: options.connection.configuration, gateway });
    const poller = startRuntimePoller({ source, publish: createRuntimePublisher(metadata) });
    let closing: Promise<void> | undefined;
    return Object.freeze({ state: () => poller.state(), close: () => {
      closing ??= Promise.resolve().then(() => drainAgent(poller, gateway)); return closing;
    } });
  } catch (error) {
    try { await drainAgent(source, gateway); }
    catch (closeError) { throw new AggregateError([error, closeError], 'Agent runtime startup failed', { cause: closeError }); }
    throw error;
  }
}
