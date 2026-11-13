import { readExecutionBinding } from '../execution-binding/index.js';
import type { DatabaseSync } from 'node:sqlite';
import type { Run, RunResultSnapshot } from '@beetle/contracts/api';
import type { RunKey } from '../../../../ports/runs.js';
import { readEnvelope } from '../output-custody/index.js';
import { transaction } from '../transaction.js';
import { StorageError } from '../protocol.js';
import { captureResultOperation, captureResultReply } from './wire.js';
export { resultOperation, captureResultOperation, captureResultReply } from './wire.js';
export type { ResultOperation } from './wire.js';

interface RunLookup { get(key: RunKey): Run }

/** Scoped, read-only projection of the retained sole manifest. No files, caches,
 * terminal transitions or publication effects. One transaction owns all reads.
 * Request <=4096 bytes, reply <=73728; uses the shared bounded Offer/source reader.
 * Missing scoped runs fail not_found; corrupt sources fail explicitly. Synchronous
 * reads finish before worker reply ownership releases; no detached cancellation.
 * Focused command: vitest run app/test/run-results/*.test.ts.
 */
export class RunResults {
  constructor(private readonly db: DatabaseSync, private readonly runs: RunLookup) {}
  get(input: RunKey): RunResultSnapshot {
    const { key } = captureResultOperation({ kind: 'getRunResult', key: input });
    return transaction(this.db, () => {
      const run = this.runs.get(key);
      const binding = readExecutionBinding(this.db, run, 'published');
      const source = binding === null ? null : readEnvelope(this.db, binding);
      if (source !== null) {
        const engine = source.manifest.binding.engine;
        if (engine.id !== run.engine.id || engine.imageDigest !== run.engine.imageDigest
          || engine.configVersion !== run.engine.configVersion) throw new StorageError('conflict');
      }
      return captureResultReply(key, { id: run.id, scope: run.scope, activeAttemptId: run.activeAttemptId,
        result: source?.manifest.result ?? null });
    });
  }
}
