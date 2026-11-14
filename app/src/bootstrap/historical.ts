import { openApplicationSession } from './local-access.js';
import type { FastifyInstance } from 'fastify';
import { apiOperations } from '@beetle/contracts/api';
import { ApiFault } from '../adapters/inbound/http/api-errors.js';
import type { LocalSessionStore } from '../ports/local-session.js';
import type { InputStore } from '../ports/inputs.js';
import type { InputService } from '../ports/input-service.js';
import type { AgentRuntime } from './agent-runtime.js';
export type HistoricalOutputRead = NonNullable<AgentRuntime['publishedBytes']>;
export type HistoricalInputStore = InputStore;
export type HistoricalInputService = InputService;
/** Trusted historical composition only; no configuration file can inject these ports. */
export interface HistoricalOptions {
  readonly historyId: string;
  readonly sessions: LocalSessionStore;
  readonly bytes: HistoricalOutputRead;
  readonly openInputs: (store: InputStore) => InputService | undefined;
  close(): Promise<void>;
}
interface HistoricalApplication {
  readonly externalOrigin: string; readonly localAccess?: 'paired' | 'automatic'; readonly historical?: HistoricalOptions;
  readonly metadata: {readonly readOnly?: true; readonly runtime: unknown};
  readonly agent?: unknown; readonly inputsDirectory?: string; readonly recoveryControl?: unknown;
}
export function captureHistorical(options: HistoricalApplication): HistoricalOptions | undefined {
  const history = options.historical;
  if (!history) {
    if (options.metadata.readOnly) throw new TypeError('Historical composition required'); return undefined;
  }
  if (options.metadata.readOnly !== true || options.metadata.runtime !== null || options.localAccess !== 'automatic') throw new TypeError('Invalid historical metadata');
  if (options.agent !== undefined || options.inputsDirectory !== undefined || options.recoveryControl !== undefined) throw new TypeError('Historical execution unavailable');
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(history.historyId)) throw new TypeError('Invalid historical identity');
  return history;
}
export function protectHistorical(server: FastifyInstance): void {
  const names = new Set(['openLocalBrowserSession','pairBrowserSession','logoutBrowserSession']);
  const exchanges = new Set(apiOperations.filter(operation => names.has(operation.name)).map(operation => `${operation.method} ${operation.path}`));
  server.addHook('onRequest', async request => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    if (!exchanges.has(`${request.method} ${request.routeOptions.url}`)) throw new ApiFault('forbidden');
  });
}

export { OutputByteError as HistoricalByteError } from '../ports/output-bytes.js';

export function applicationMode(options: HistoricalApplication) {
  const history = captureHistorical(options);
  return Object.freeze({historical: history !== undefined,
    protect: (server: FastifyInstance) => {if (history) protectHistorical(server);},
    session: (store: LocalSessionStore) => openApplicationSession(options.externalOrigin, options.localAccess ?? 'paired', history?.sessions ?? store,
      history ? {readOnly: true, cookieName: 'beetle_history_' + history.historyId.replaceAll('-', '')} : undefined),
    inputs: (store: InputStore) => history?.openInputs(store),
    reads: (runtime: AgentRuntime | undefined) => history ? {publishedBytes: history.bytes} : runtime,
    close: async () => {await history?.close();}});
}
