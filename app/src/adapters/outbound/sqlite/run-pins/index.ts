import type { DatabaseSync } from 'node:sqlite';
import type { Run, RunPinReceipt } from '@beetle/contracts/api';
import type { RunKey, RunPinCommand } from '../../../../ports/runs.js';
import { checkedRunPinReceipt } from '../../../../application/runs/index.js';
import { readMutationReceipt, writeMutationReceipt } from '../mutation-receipts.js';
import { requireVisibleOrganization, requireVisibleWorkspace } from '../workspace-retirement/visibility.js';
import { transaction } from '../transaction.js';
import { StorageError } from '../protocol.js';
import type { Operation } from '../protocol.js';
import { RUN_PIN_LIMIT } from '../migration033.js';
import { runPinnedAt, workspacePinCount } from './state.js';

export { runPinnedAt, requireUnpinned, pinnedRunsSql } from './state.js';
export type RunPinOperation = Extract<Operation, { kind: 'runPin' }>;
export const RUN_PIN_MESSAGE_LIMIT = 4096;
export function runPinOperation(operation: Operation): operation is RunPinOperation {
  return operation.kind === 'runPin';
}
/**
 * One immediate transaction owns visibility, receipt replay, pin state and the
 * receipt. Removal admission uses the same single writer, so a pin either commits
 * first and excludes the run, or finds the admitted intent and refuses.
 */
export class RunPins {
  constructor(
    private readonly db: DatabaseSync,
    private readonly runs: { get(key: RunKey): Run },
  ) {}
  execute(operation: RunPinOperation): RunPinReceipt {
    const command = operation.command;
    return transaction(this.db, () => {
      requireVisibleOrganization(this.db, command.request.scope.organizationId);
      requireVisibleWorkspace(this.db, command.request.scope);
      const stored = readMutationReceipt(this.db, command, RUN_PIN_MESSAGE_LIMIT);
      if (stored.kind === 'stored') return capture(stored.value, command);
      const receipt = capture(this.change(command), command);
      return writeMutationReceipt(this.db, command, receipt, RUN_PIN_MESSAGE_LIMIT) as RunPinReceipt;
    });
  }
  private change(command: RunPinCommand): RunPinReceipt {
    const scope = command.request.scope;
    const run = this.runs.get({ scope, id: command.id });
    const base = { id: run.id, scope: run.scope, requestId: command.request.requestId.toLowerCase() };
    const pinnedAt = runPinnedAt(this.db, scope, run.id);
    if (command.kind === 'unpinRun') {
      if (pinnedAt !== null) this.db.prepare('DELETE FROM run_pins WHERE run_id=?').run(run.id);
      return { ...base, pinned: false };
    }
    if (pinnedAt !== null) return { ...base, pinned: true, pinnedAt };
    if (!['finished', 'cancelled', 'errored'].includes(run.state) || run.outcome === 'pending')
      throw new StorageError('run_active');
    if (this.db.prepare('SELECT 1 FROM output_deletion_intents WHERE run_id=? LIMIT 1').get(run.id))
      throw new StorageError('cleanup_in_progress');
    if (workspacePinCount(this.db, scope) >= RUN_PIN_LIMIT) throw new StorageError('pin_limit');
    this.db
      .prepare('INSERT INTO run_pins(run_id,organization_id,workspace_id,pinned_at,request_id) VALUES(?,?,?,?,?)')
      .run(run.id, run.scope.organizationId, run.scope.workspaceId, command.requestedAt, base.requestId);
    return { ...base, pinned: true, pinnedAt: command.requestedAt };
  }
}
function capture(value: unknown, command: RunPinCommand): RunPinReceipt {
  try {
    return checkedRunPinReceipt(value, command);
  } catch {
    throw new StorageError('unavailable');
  }
}
