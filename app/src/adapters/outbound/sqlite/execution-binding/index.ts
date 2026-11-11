import type { DatabaseSync } from 'node:sqlite';
import type { Run } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import type { RunExecutionSnapshot } from '../../../../ports/run-live-metrics.js';
import { readExecutionBinding } from './binding.js';
import { transaction } from '../schema.js';
import { captureExecutionOperation, captureExecutionReply } from './wire.js';
export { readExecutionBinding };
export { captureExecutionOperation, captureExecutionReply, executionOperation } from './wire.js';
interface RunLookup {get(key: RunKey): Run}
/** Read-only compact authority; no Offer payload, mutation, scan or current-capability substitution. */
export class RunExecutions {
  constructor(private readonly db: DatabaseSync, private readonly runs: RunLookup) {}
  get(input: RunKey): RunExecutionSnapshot {
    const {key} = captureExecutionOperation({kind: 'getRunExecution', key: input});
    return transaction(this.db, () => {
      const run = this.runs.get(key);
      return captureExecutionReply(key, {run, binding: readExecutionBinding(this.db, run, 'live')});
    });
  }
}
