import type { FastifyInstance } from 'fastify';
import { apiOperations } from '@beetle/contracts/api';
import { ApiFault } from '../adapters/inbound/http/api-errors.js';

/**
 * Offline upgrade fence. The installer sets `upgradeFence` (the upgrade operation UUID)
 * in the ready configuration selector together with the new pins and clears it only on
 * explicit activation. While set, the serving backend accepts reads, browser-session
 * exchanges, cancellation and previews, and refuses every other mutation before body
 * parsing. The closed API error set has no upgrade code yet, so refusals use the
 * retryable 503 `capacity_unavailable`.
 */
export function upgradeFenced(receipt: unknown): boolean {
  if (receipt === null || typeof receipt !== 'object' || Array.isArray(receipt)) return false;
  if (!Object.hasOwn(receipt, 'upgradeFence')) return false;
  const fence = (receipt as Record<string, unknown>).upgradeFence;
  if (typeof fence !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u.test(fence))
    throw new TypeError('Invalid upgrade fence');
  return true;
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
      throw new ApiFault('capacity_unavailable');
  });
}
