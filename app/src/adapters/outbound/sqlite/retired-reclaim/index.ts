import type { DatabaseSync } from 'node:sqlite';
import type { Run, WorkspaceScope } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type {
  OutputDeletionCommand,
  OutputDeletionPage,
  OutputDeletionSummary,
  RetiredReclaimQuery,
} from '../../../../ports/output-deletion-metadata.js';
import { prepareOutputDeletion } from '../../../../application/output-deletion/index.js';
import { SemanticError } from '../../../../domain/namespaces/index.js';
import { requireCleanupControl } from '../cleanup-control/index.js';
import { captureFacts } from '../output-deletion/facts.js';
import { StorageError } from '../protocol.js';
import { sha256 } from '../input-values.js';
import { reclaimCursor, reclaimPosition } from './cursor.js';
import type { ReclaimPosition } from './cursor.js';
import { nextWorkspace, reclaimIdentity, retiredRuns } from './candidates.js';
import type { ReclaimRow } from './candidates.js';
export { reclaimPosition } from './cursor.js';
type Begin = (command: OutputDeletionCommand) => OutputDeletionSummary;
interface Context {
  readonly db: DatabaseSync;
  readonly runs: { get(key: RunKey): Run };
  readonly begin: Begin;
  readonly requestedAt: string;
}
/**
 * One caller-owned immediate transaction. Reads at most `limit` workspace or Run rows after the
 * cursor and begins the ordinary deletion intent for each eligible terminal Run of a retired
 * workspace. No receipt, charge, refund or native effect: the intent rides the funded cleanup
 * control and the existing file, retirement and settlement lanes. A null cursor means a full pass.
 */
export function reclaimRetired(
  db: DatabaseSync,
  runs: { get(key: RunKey): Run },
  begin: Begin,
  query: RetiredReclaimQuery,
): OutputDeletionPage {
  if (!db.isTransaction) throw new StorageError('conflict');
  const context = { db, runs, begin, requestedAt: query.requestedAt };
  const items: OutputDeletionSummary[] = [];
  let at = reclaimPosition(query.cursor);
  let budget = query.limit;
  while (budget > 0) {
    if (!at.inside) {
      budget--;
      const next = nextWorkspace(db, at);
      if (!next) return { items, nextCursor: null };
      at = { organizationId: next.organizationId, workspaceId: next.workspaceId, runId: '', inside: next.retired };
      continue;
    }
    const rows = retiredRuns(db, at, budget);
    budget -= rows.length;
    for (const row of rows) {
      at = { ...at, runId: row.id };
      const begun = reclaimRun(context, at, row);
      if (begun) items.push(begun);
    }
    if (budget > 0) at = { ...at, inside: false };
  }
  return { items, nextCursor: reclaimCursor(at) };
}
/** Positive custody facts and existing funded control first; any later Begin failure aborts the turn. */
function reclaimRun(context: Context, at: ReclaimPosition, row: ReclaimRow): OutputDeletionSummary | null {
  if (!row.open) return null;
  const scope: WorkspaceScope = { kind: 'workspace', organizationId: at.organizationId, workspaceId: at.workspaceId };
  const request = {
    scope,
    runId: row.id,
    requestId: reclaimIdentity('request', row.id),
    expectedRunVersion: row.version,
  };
  try {
    const facts = captureFacts(context.db, context.runs, { request });
    requireCleanupControl(context.db, {
      runId: facts.run.id,
      attemptId: facts.run.activeAttemptId,
      organizationId: scope.organizationId,
      workspaceId: scope.workspaceId,
    });
  } catch (error) {
    // Same classification as retention selection: unproven custody or unfunded control waits.
    if (error instanceof StorageError || error instanceof SemanticError) return null;
    throw error;
  }
  const command = prepareOutputDeletion(
    { kind: 'beginOutputDeletion', id: reclaimIdentity('deletion', row.id), requestedAt: context.requestedAt, request },
    sha256,
  );
  return context.begin(command);
}
