import { captureAgentRuntime, agentMetadata, openAgentRuntime } from './agent-runtime.js';
import type { AgentRuntime, AgentRuntimeOptions } from './agent-runtime.js';
import type { RuntimePollerState } from './runtime-poller.js';
import { closeApplicationStore, throwCloseFailures } from './application-close.js';
import { registerSuiteRoutes } from '../adapters/inbound/http/suites/index.js';
import { registerRunRoutes } from '../adapters/inbound/http/runs/index.js';
import { createHash, randomUUID } from 'node:crypto';
import { encodeJson } from '@beetle/contracts';
import { API_MAXIMUM_JSON_BYTES, apiSchemas } from '@beetle/contracts/api';
import type { FastifyInstance } from 'fastify';
import { createApiServer } from '../adapters/inbound/http/api-errors.js';
import { configureSchemaCompilers } from '../adapters/inbound/http/schema-compilers.js';
import { registerNamespaceRoutes } from '../adapters/inbound/http/namespaces/index.js';
import { registerSettingsRoutes } from '../adapters/inbound/http/settings/index.js';
import { createLocalSession } from '../adapters/inbound/http/session/index.js';
import { openMetadata } from '../adapters/outbound/sqlite/index.js';
import type { Metadata, MetadataOptions, RuntimeObservation } from '../adapters/outbound/sqlite/index.js';
import { classifyMetadataError } from './metadata-errors.js';
import { openInputRuntime } from './input-runtime.js';
import type { InputRuntime } from './input-runtime.js';
import type { InputMaintenanceState } from './input-maintenance.js';
import { registerInputRoutes } from '../adapters/inbound/http/inputs/index.js';
import type { InputHttp } from '../adapters/inbound/http/inputs/index.js';

export interface ApplicationOptions {
  readonly externalOrigin: string;
  readonly metadata: MetadataOptions;
  readonly agent?: AgentRuntimeOptions;
  /** Canonical installation-owned child of the private data directory. */
  readonly inputsDirectory?: string;
}
export interface Application {
  readonly server: FastifyInstance;
  /** For explicit local startup output only; never an HTTP response. */
  readonly bootstrapToken: string;
  readonly updateRuntime: (observation: RuntimeObservation | null) => Promise<null>;
  readonly inputRecoveryState: () => InputMaintenanceState | 'disabled';
  readonly runtimeState: () => RuntimePollerState | 'disabled';
  readonly close: () => Promise<void>;
}
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Local session, authoring and installation-owned input composition. */
export async function openApplication(options: ApplicationOptions): Promise<Application> {
  const agent = options.agent === undefined ? undefined : captureAgentRuntime(options.agent, options.metadata, options.inputsDirectory);
  const session = createLocalSession({ externalOrigin: options.externalOrigin });
  const server = createApiServer({ classify: classifyMetadataError });
  let metadata: Metadata | undefined;
  let agentRuntime: AgentRuntime | undefined;
  let inputRuntime: InputRuntime | undefined; let inputHttp: InputHttp | undefined;
  try {
    configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson, maximumResponseBytes: API_MAXIMUM_JSON_BYTES });
    metadata = await openMetadata(agentMetadata(options.metadata, agent));
    const store = metadata;
    if (options.inputsDirectory !== undefined) inputRuntime = await openInputRuntime(options.inputsDirectory, store.inputs);
    if (agent) agentRuntime = await openAgentRuntime(agent, store);
    session.registerRoutes(server);
    registerNamespaceRoutes(server, { store: store.namespaces, reader: store, newId: randomUUID,
      digest, authorize: session.authorize });
    registerSuiteRoutes(server, { store: store.suites, reader: store.suites, newId: randomUUID, digest, authorize: session.authorize });
    registerRunRoutes(server, { store: store.runs, reader: store.runs, newId: randomUUID, digest,
      now: () => new Date().toISOString(), authorize: session.authorize });
    registerSettingsRoutes(server, { store: store.settings, reader: store, digest, authorize: session.authorize });
    if (inputRuntime) inputHttp = registerInputRoutes(server, { inputs: inputRuntime.inputs, newId: randomUUID, authorize: session.authorize });
    server.addHook('onClose', async () => {
      session.close();
      await closeApplicationStore(agentRuntime, inputRuntime, store);
    });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      session.close();
      if (!closing) {
        closing = Promise.resolve().then(async () => {
          const results = await Promise.allSettled([Promise.resolve().then(() => inputHttp?.close()),
            Promise.resolve().then(() => agentRuntime?.close()), Promise.resolve().then(() => inputRuntime?.close()),
            Promise.resolve().then(() => server.close())]);
          throwCloseFailures(results);
        });
      }
      return closing;
    };
    await server.ready();
    return Object.freeze({ server, bootstrapToken: session.bootstrapToken,
      inputRecoveryState: () => inputRuntime?.recoveryState() ?? 'disabled',
      runtimeState: () => agentRuntime?.state() ?? 'disabled',
      updateRuntime: (observation: RuntimeObservation | null) => store.updateRuntime(observation), close });
  } catch (error) {
    session.close();
    const resources = await Promise.allSettled([Promise.resolve().then(() => inputHttp?.close()),
      Promise.resolve().then(() => agentRuntime?.close()), Promise.resolve().then(() => inputRuntime?.close()), Promise.resolve().then(() => server.close())]);
    const store = await Promise.allSettled([metadata?.abort()]);
    throwCloseFailures([{ status: 'rejected', reason: error }, ...resources, ...store]);
    throw error;
  }
}
