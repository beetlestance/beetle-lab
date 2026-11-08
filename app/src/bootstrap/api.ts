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

export interface ApplicationOptions {
  readonly externalOrigin: string;
  readonly metadata: MetadataOptions;
}
export interface Application {
  readonly server: FastifyInstance;
  /** For explicit local startup output only; never an HTTP response. */
  readonly bootstrapToken: string;
  readonly updateRuntime: (observation: RuntimeObservation | null) => Promise<null>;
  readonly close: () => Promise<void>;
}
const digest = (value: string): string => createHash('sha256').update(value, 'utf8').digest('hex');

/** Real namespace/settings composition. This does not install a fake engine,
 * invent capacity, or claim the still-incomplete suite/run execution surface.
 */
export async function openApplication(options: ApplicationOptions): Promise<Application> {
  const session = createLocalSession({ externalOrigin: options.externalOrigin });
  const server = createApiServer({ classify: classifyMetadataError });
  let metadata: Metadata | undefined;
  try {
    configureSchemaCompilers(server, { schemas: apiSchemas, encodeJson, maximumResponseBytes: API_MAXIMUM_JSON_BYTES });
    metadata = await openMetadata(options.metadata);
    const store = metadata;
    session.registerRoutes(server);
    registerNamespaceRoutes(server, { store: store.namespaces, reader: store, newId: randomUUID,
      digest, authorize: session.authorize });
    registerSettingsRoutes(server, { store: store.settings, reader: store, digest, authorize: session.authorize });
    server.addHook('onClose', async () => { session.close(); await store.close(); });
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      session.close();
      closing ??= server.close();
      return closing;
    };
    await server.ready();
    return Object.freeze({ server, bootstrapToken: session.bootstrapToken,
      updateRuntime: (observation: RuntimeObservation | null) => store.updateRuntime(observation), close });
  } catch (error) {
    session.close();
    await Promise.allSettled([server.close(), ...(metadata ? [metadata.abort()] : [])]);
    throw error;
  }
}
