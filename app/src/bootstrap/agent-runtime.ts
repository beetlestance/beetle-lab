import { dirname, isAbsolute, join, normalize } from 'node:path';
import { encodeJson } from '@beetle/contracts';
import { immutableSnapshot, requireRule } from '../domain/namespaces/index.js';
import type { LoadedAgentConfiguration } from '../ports/runner.js';
import type { CapacitySource } from '../ports/runtime.js';
import { createRunnerGateway } from '../adapters/outbound/runner/index.js';
import { openCapacitySource } from '../adapters/outbound/capacity/index.js';
import type { Metadata, MetadataOptions } from '../adapters/outbound/sqlite/index.js';
import { openAgentOwners } from './agent-owners.js';
import { openOutputRuntime } from './output-runtime/index.js';
import { captureDeliveryMetadata, captureOutputMetadata, captureGateway } from './output-parent/capture.js';
import type { AgentRuntime } from './agent-owners.js';
export type { AgentRuntime } from './agent-owners.js';

export interface AgentRuntimeOptions {
  readonly connection: LoadedAgentConfiguration;
  readonly dataRoot: string;
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
/** Capacity and delivery share one installation-owned gateway and its credits. */
export async function openAgentRuntime(options: AgentRuntimeOptions, metadata: Metadata): Promise<AgentRuntime> {
  const dataRoot = options.dataRoot; const configuration = options.connection.configuration;
  const outputMetadata = captureOutputMetadata(metadata); const deliveryMetadata = captureDeliveryMetadata(metadata);
  const freeSpaceReserveBytes = configuration.freeSpaceReserveBytes;
  const gateway = createRunnerGateway(options.connection);
  const capturedGateway = captureGateway(gateway);
  const outputGateway = Object.freeze({ output: gateway.output.bind(gateway) });
  let source: CapacitySource;
  try {
    source = await openCapacitySource({ dataRoot, configuration, gateway });
  } catch (error) {
    try { await capturedGateway.close(); }
    catch (closeError) { throw new AggregateError([error, closeError], 'Agent runtime startup failed', { cause: closeError }); }
    throw error;
  }
  return openAgentOwners({ source, gateway: capturedGateway, metadata: deliveryMetadata,
    openOutputs: onFailure => openOutputRuntime({ dataRoot, ...outputMetadata,
      gateway: outputGateway, freeSpaceReserveBytes, onFailure }) });
}
