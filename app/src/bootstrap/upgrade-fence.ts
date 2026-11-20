import type { FastifyInstance } from 'fastify';
import { apiOperations } from '@beetle/contracts/api';
import { ApiFault } from '../adapters/inbound/http/api-errors.js';
import { METADATA_SCHEMA_VERSION } from '../adapters/outbound/sqlite/schema.js';

/**
 * Offline upgrade fence. The installer sets `upgradeFence` (the upgrade operation UUID)
 * in the ready configuration selector together with the new pins and clears it only on
 * explicit activation. While set, the serving backend accepts reads, browser-session
 * exchanges, cancellation and previews, and refuses every other mutation before body
 * parsing with the retryable 503 `upgrade_pending`.
 */
export function upgradeFenced(receipt: unknown): string | null {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) return null;
  if (!Object.hasOwn(receipt, 'upgradeFence')) return null;
  const fence = (receipt as Record<string, unknown>).upgradeFence;
  if (typeof fence !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(fence))
    throw new TypeError('Invalid upgrade fence');
  return fence;
}
/** Release names are optional build metadata; an absent or invalid name is reported as unknown, never guessed. */
export function releaseName(value: string | undefined): string | null {
  return value && /^[0-9A-Za-z][0-9A-Za-z.+-]{0,63}$/u.test(value) ? value : null;
}
/** What the upgrade status reports about this process: its release, metadata schema and fence. */
export function upgradeFacts(options: { readonly upgradeFence?: string; readonly release?: string }) {
  return {
    release: options.release ?? null,
    metadataSchema: METADATA_SCHEMA_VERSION,
    fence: options.upgradeFence ?? null,
  };
}
const permitted = new Set([
  'openLocalBrowserSession',
  'pairBrowserSession',
  'logoutBrowserSession',
  'cancelRun',
  'cancelExport',
  'compareRuns',
  'previewInstallationRetention',
  'previewOrganizationRetention',
  'previewWorkspaceRetention',
  'previewRunDeletion',
]);
export const upgradeFenceExchanges: ReadonlySet<string> = new Set(
  apiOperations
    .filter((operation) => permitted.has(operation.name))
    .map((operation) => `${operation.method} ${operation.path}`),
);
export function protectUpgrade(server: FastifyInstance): void {
  server.addHook('onRequest', async (request) => {
    if (request.method === 'GET' || request.method === 'HEAD') return;
    if (!upgradeFenceExchanges.has(`${request.method} ${request.routeOptions.url}`))
      throw new ApiFault('upgrade_pending');
  });
}
