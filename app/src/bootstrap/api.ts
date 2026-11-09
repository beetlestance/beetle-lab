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
  /** Canonical installation-owned child of the private data directory. */
  readonly inputsDirectory?: string;
}
export interface Application {
  readonly server: FastifyInstance;
  /** For explicit local startup output only; never an HTTP response. */
  readonly bootstrapToken: string;
  readonly updateRuntime: (observation: RuntimeObservation | null) => Promise<null>;
  readonly inputRecoveryState: () => InputMaintenanceState | 'disabled';
  readonly close: () => Promise<void>;
}
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Local session, authoring and installation-owned input composition. */
export async function openApplication(options: ApplicationOptions): Promise<Application> {
  const session = createLocalSession({ externalOrigin: options.externalOrigin });
  const server = createApiServer({ classify: classifyMetadataError });
  let metadata: Metadata | undefined;
  let inputRuntime: InputRuntime | undefined; let inputHttp: InputHttp | undefined;
  try {
    configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson, maximumResponseBytes: API_MAXIMUM_JSON_BYTES });
    metadata = await openMetadata(options.metadata);
    const store = metadata;
    if (options.inputsDirectory !== undefined) inputRuntime = await openInputRuntime(options.inputsDirectory, store.inputs);
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
      try { await inputRuntime?.close(); } finally { await store.close(); }
    });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      session.close();
      if (!closing) {
        const streams = inputHttp?.close(); const files = inputRuntime?.close(); const listener = server.close();
        closing = Promise.allSettled([streams, files, listener]).then(results => {
          for (const result of results) if (result.status === 'rejected') throw result.reason;
        });
      }
      return closing;
    };
    await server.ready();
    return Object.freeze({ server, bootstrapToken: session.bootstrapToken,
      inputRecoveryState: () => inputRuntime?.recoveryState() ?? 'disabled',
      updateRuntime: (observation: RuntimeObservation | null) => store.updateRuntime(observation), close });
  } catch (error) {
    session.close();
    const streams = inputHttp?.close(); const files = inputRuntime?.close();
    await Promise.allSettled([streams, files, server.close()]);
    if (metadata) await metadata.abort();
    throw error;
  }
}
