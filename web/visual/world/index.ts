// The world every screenshot shows: one installation, the "Platform team" organization and
// its "Checkout" workspace. Contract fixtures supply valid shapes; scenarios override fields.
import { readFileSync } from 'node:fs';
import type { Api, Json } from '../harness.js';
import { NOW } from '../harness.js';

export const ids = {
  organization: '00000000-0000-4000-8000-000000000001',
  workspace: '00000000-0000-4000-8000-000000000002',
  rootFolder: '00000000-0000-4000-8000-000000000003',
} as const;

/** A contract fixture from contracts/fixtures/api/valid, parsed fresh so callers may mutate it. */
export function fixture<T = Record<string, Json>>(name: string): T {
  const url = new URL(`../../../contracts/fixtures/api/valid/${name}.json`, import.meta.url);
  return JSON.parse(readFileSync(url, 'utf8')) as T;
}

export const organization = { ...fixture('organization'), name: 'Platform team', slug: 'platform-team' };
export const workspace = { ...fixture('workspace'), name: 'Checkout' };

/** Session, installation, organization and workspace reads every signed-in screen makes. */
export function signedIn(api: Api): Api {
  return api
    .on('getBrowserSession', { ...fixture('browser-session'), expiresAt: '2026-11-08T23:40:00.000Z' })
    .on('listOrganizations', { scope: { kind: 'installation' }, items: [organization], nextCursor: null })
    .on('getOrganization', organization)
    .on('listWorkspaces', {
      scope: { kind: 'organization', organizationId: ids.organization },
      items: [workspace],
      nextCursor: null,
    })
    .on('getWorkspace', workspace)
    .on('getInstallationStatus', { ...fixture('installation-status'), generatedAt: NOW })
    .on('getUpgradeStatus', {
      ...fixture('upgrade-status'),
      phase: 'open',
      operationId: null,
      unfinished: { runs: 0, exports: 0, uploads: 0, removals: 0 },
      generatedAt: NOW,
    });
}
