import { openApplicationSession } from './local-access.js';
import type { FastifyInstance } from 'fastify';
import { apiOperations, validateApi } from '@beetle/contracts/api';
import type { RestoredBackup } from '@beetle/contracts/api';
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
  /** Operator-supplied navigation only. The archive cannot choose the destination. */
  readonly liveOrigin?: string | undefined;
  /** Sealed manifest header: archive identity and the backup tool's creation time. */
  readonly backup: { readonly backupId: string; readonly createdAt: string };
  readonly sessions: LocalSessionStore;
  readonly bytes: HistoricalOutputRead;
  readonly openInputs: (store: InputStore) => InputService | undefined;
  close(): Promise<void>;
}
interface HistoricalApplication {
  readonly externalOrigin: string;
  readonly localAccess?: 'paired' | 'automatic';
  readonly access?: 'local' | 'network';
  readonly historical?: HistoricalOptions;
  readonly metadata: { readonly readOnly?: true; readonly runtime: unknown };
  readonly agent?: unknown;
  readonly inputsDirectory?: string;
  readonly recoveryControl?: unknown;
}
export function captureHistorical(options: HistoricalApplication): HistoricalOptions | undefined {
  const history = options.historical;
  if (!history) {
    if (options.metadata.readOnly) throw new TypeError('Historical composition required');
    return undefined;
  }
  if (options.metadata.readOnly !== true || options.metadata.runtime !== null || options.localAccess !== 'automatic')
    throw new TypeError('Invalid historical metadata');
  loopbackOnly(options.access);
  if (options.agent !== undefined || options.inputsDirectory !== undefined || options.recoveryControl !== undefined)
    throw new TypeError('Historical execution unavailable');
  if (!/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(history.historyId))
    throw new TypeError('Invalid historical identity');
  restoredBackup(history.backup);
  return history;
}
/** The history viewer stays loopback-only (decision 032). */
function loopbackOnly(access: HistoricalApplication['access']): void {
  if (access !== undefined && access !== 'local') throw new TypeError('Historical network access unavailable');
}
/** Canonical UTC millisecond form of the sealed header time; an unparsable time refuses composition. */
export function restoredBackup(backup: HistoricalOptions['backup']): RestoredBackup {
  const time =
    typeof backup?.createdAt === 'string' && backup.createdAt.length <= 64 ? Date.parse(backup.createdAt) : NaN;
  if (!Number.isFinite(time)) throw new TypeError('Invalid historical backup');
  const value = { backupId: String(backup.backupId).toLowerCase(), createdAt: new Date(time).toISOString() };
  if (!validateApi('RestoredBackup', value).ok) throw new TypeError('Invalid historical backup');
  return Object.freeze(value);
}
export function protectHistorical(server: FastifyInstance): void {
  const names = new Set(['openLocalBrowserSession', 'pairBrowserSession', 'logoutBrowserSession']);
  const exchanges = new Set(
    apiOperations
      .filter((operation) => names.has(operation.name))
      .map((operation) => `${operation.method} ${operation.path}`),
  );
  server.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    if (!exchanges.has(`${request.method} ${request.routeOptions.url}`)) throw new ApiFault('forbidden');
  });
}

export { OutputByteError as HistoricalByteError } from '../ports/output-bytes.js';

export function applicationMode(options: HistoricalApplication) {
  const history = captureHistorical(options);
  return Object.freeze({
    historical: history !== undefined,
    protect: (server: FastifyInstance) => {
      if (history) protectHistorical(server);
    },
    session: (store: LocalSessionStore) =>
      openApplicationSession(
        options.externalOrigin,
        options.localAccess ?? 'paired',
        history?.sessions ?? store,
        history
          ? {
              readOnly: true,
              cookieName: 'beetle_history_' + history.historyId.replaceAll('-', ''),
              restoredBackup: restoredBackup(history.backup),
              ...(history.liveOrigin !== undefined ? { liveOrigin: history.liveOrigin } : {}),
            }
          : undefined,
        history ? 'local' : options.access,
      ),
    inputs: (store: InputStore) => history?.openInputs(store),
    reads: (runtime: AgentRuntime | undefined) => (history ? { publishedBytes: history.bytes } : runtime),
    close: async () => {
      await history?.close();
    },
  });
}
