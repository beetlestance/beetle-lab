import type { DatabaseSync } from 'node:sqlite';
import type { Store } from '../../src/adapters/outbound/sqlite/store.js';
import type { OutputDeletionPage, RetiredReclaimQuery } from '../../src/ports/output-deletion-metadata.js';
import { prepareNamespaceDeletion } from '../../src/application/namespace-deletion/index.js';
import { digest, requestId } from '../storage/fixture.js';
export const requestedAt = '2026-11-20T00:00:00.000Z';
export function reclaim(store: Store, query: Partial<RetiredReclaimQuery> = {}): OutputDeletionPage {
  return store.execute({
    kind: 'reclaimRetiredOutputs',
    query: { limit: 32, requestedAt, ...query },
  }) as OutputDeletionPage;
}
/** Every page of one pass; asserts each page stays inside its budget. */
export function pass(store: Store, limit = 32): { pages: OutputDeletionPage[]; begun: string[] } {
  const pages: OutputDeletionPage[] = [];
  let cursor: string | undefined;
  for (let turn = 0; turn < 1000; turn++) {
    const page = reclaim(store, { limit, ...(cursor ? { cursor } : {}) });
    if (page.items.length > limit) throw Error('Unbounded page');
    pages.push(page);
    if (page.nextCursor === null) return { pages, begun: pages.flatMap((p) => p.items.map((item) => item.runId)) };
    cursor = page.nextCursor;
  }
  throw Error('Pass did not finish');
}
export function retireWorkspace(store: Store, organizationId: string, workspaceId: string): void {
  const command = prepareNamespaceDeletion(
    {
      kind: 'workspace',
      id: workspaceId,
      request: { scope: { kind: 'organization', organizationId }, requestId: requestId(), expectedVersion: 1 },
    },
    digest,
  );
  store.execute({ kind: 'deleteNamespace', command });
}
export function retireOrganization(store: Store, organizationId: string): void {
  const command = prepareNamespaceDeletion(
    {
      kind: 'organization',
      id: organizationId,
      request: { scope: { kind: 'installation' }, requestId: requestId(), expectedVersion: 1 },
    },
    digest,
  );
  store.execute({ kind: 'deleteNamespace', command });
}
export function count(db: DatabaseSync, sql: string, ...values: string[]): number {
  return Number(db.prepare(sql).get(...values)?.n);
}
export function usage(db: DatabaseSync): number {
  return Number(db.prepare('SELECT charged_bytes FROM installation_storage_usage').get()?.charged_bytes);
}
