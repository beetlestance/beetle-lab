import { encodeCanonicalJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { OutputDeletionPage } from '../../ports/output-deletion-metadata.js';
import type { OutputFileContext } from '../../ports/output-bytes.js';
import type { ReclaimProgress } from './types.js';
import { check } from './step.js';
/** Rows examined per turn; matches the other bounded discovery lanes. */
export const RECLAIM_LIMIT = 32;
/** A full pass that began nothing waits this long before walking the namespace again. */
export const RECLAIM_IDLE_MS = 30000;
/**
 * Backend-owned intent creation for retired workspaces. It only begins ordinary deletion
 * intents; file removal, agent retirement and settlement stay with their own turns.
 */
export class Reclaims {
  private cursor: string | undefined;
  private begunInPass = 0;
  private idleUntil = 0;
  constructor(private readonly options: ReclaimProgress) {}
  async step(context: OutputFileContext): Promise<void> {
    const now = this.options.clock();
    if (now < this.idleUntil) return;
    check(context);
    const query = {
      limit: RECLAIM_LIMIT,
      requestedAt: new Date(now).toISOString(),
      ...(this.cursor ? { cursor: this.cursor } : {}),
    };
    const page = reclaimPage(await this.options.metadata.reclaimRetired(query), query.requestedAt);
    check(context);
    this.begunInPass += page.items.length;
    this.cursor = page.nextCursor ?? undefined;
    if (page.nextCursor !== null) return;
    if (this.begunInPass === 0) this.idleUntil = now + RECLAIM_IDLE_MS;
    this.begunInPass = 0;
  }
}
function reclaimPage(input: OutputDeletionPage, requestedAt: string): OutputDeletionPage {
  const page = JSON.parse(encodeCanonicalJson(input, 65536)) as OutputDeletionPage;
  const valid =
    Array.isArray(page.items) &&
    page.items.length <= RECLAIM_LIMIT &&
    (page.nextCursor === null || (typeof page.nextCursor === 'string' && page.nextCursor.length <= 256)) &&
    page.items.every(
      (item) =>
        validateApi('WorkspaceScope', item.scope).ok &&
        validateApi('Uuid', item.id).ok &&
        item.version === 1 &&
        item.requestedAt === requestedAt,
    );
  if (!valid) throw Error('Invalid reclamation page');
  return page;
}
