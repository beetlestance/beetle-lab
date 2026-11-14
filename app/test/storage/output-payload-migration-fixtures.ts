import {historicalRun} from './historical-run-fixture.js';
import { DatabaseSync } from 'node:sqlite';
import { sealEngineResult } from '@beetle/contracts';
import { migration001, transaction } from '../../src/adapters/outbound/sqlite/schema.js';
import { migration002 } from '../../src/adapters/outbound/sqlite/migration002.js';
import { migrate003 } from '../../src/adapters/outbound/sqlite/migration003.js';
import { migration004 } from '../../src/adapters/outbound/sqlite/migration004.js';
import { migration005 } from '../../src/adapters/outbound/sqlite/migration005.js';
import { migration006 } from '../../src/adapters/outbound/sqlite/migration006.js';
import { migration007 } from '../../src/adapters/outbound/sqlite/migration007.js';
import type { DispatchKey } from '../../src/ports/dispatch.js';
import { reserveHistoricalOutput, acknowledge, reserveAndMark, seedFoundation, snapshotFor } from './execution-foundation-fixtures.js';
import { runCommand, runRequest } from './runs-fixture.js';
import { result } from '../domain/run-observation-fixtures.js';
import { uuid, observation, settingsFixture } from './fixture.js';
import { hash } from './output-payload-fixtures.js';
export function legacyPayload(path: string, options: { bound?: boolean; maximum?: number; body?: boolean } = {}) {
  const db = new DatabaseSync(path, { enableForeignKeyConstraints: true });
  db.exec(migration001); db.exec(migration002); migrate003(db); db.exec(migration004); db.exec(migration005);
  if (options.bound !== false) db.exec(migration006);
  const store = seedFoundation(db);
  const values = JSON.parse(String(db.prepare("SELECT value_json FROM settings WHERE scope_key='installation'").get()?.value_json)) as ReturnType<typeof settingsFixture>['chain']['installation']['values'];
  values.pool.outputBytes = 100000; values.perRunCeilings.outputBytes = 100000;
  db.prepare("UPDATE settings SET value_json=? WHERE scope_key='installation'").run(JSON.stringify(values));
  const runtime = observation(settingsFixture().runtime); runtime.ceilings.pool.outputBytes = 100000; runtime.ceilings.perRun.outputBytes = 100000; runtime.ceilings.pool.storageBytes = 400000;
  store.execute({ kind: 'runtime', runtime });
  const request = runRequest(uuid(60)); request.budget.outputBytes = options.maximum ?? 10000;
  const run = historicalRun(db, runCommand(uuid(60), 70, request));
  const key: DispatchKey = { runId: run.id, attempt: { attemptId: run.activeAttemptId, organizationId: run.scope.organizationId,
    workspaceId: run.scope.workspaceId, intentDigest: String(db.prepare('SELECT intent_digest FROM attempts').get()?.intent_digest), generation: 1 } };
  const { seal, ...original } = result();
  const sealed = sealEngineResult({ ...original, attemptId: key.attempt.attemptId, organizationId: key.attempt.organizationId,
    workspaceId: key.attempt.workspaceId, generation: 1, artifacts: [] }, seal.sealedAt, hash);
  if (!sealed.ok) throw new Error('Invalid old result');
  const snapshot = snapshotFor(key, { state: 'exited', ...(options.body === false ? {} : { result: sealed.value }),
    admission: { state: 'released', disposition: 'settled' } });
  transaction(db, () => {
    if (options.bound !== false) reserveAndMark(db, key);
    else {
      db.prepare(`INSERT INTO execution_records(attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
        delivery_attempt_id,output_attempt_id) SELECT attempt_id,queue_order,run_id,organization_id,workspace_id,intent_digest,
        attempt_id,attempt_id FROM execution_intents`).run();
      reserveHistoricalOutput(db, key, Number.MAX_SAFE_INTEGER);
      db.exec("UPDATE dispatch_outbox SET possible_delivery=1,first_delivery_at='2026-11-09T00:00:00.000Z'");
    }
    acknowledge(db, key, snapshot); db.exec('UPDATE execution_records SET execution_charged=0');
  });
  if (options.bound === false) db.exec(migration006);
  db.exec(migration007);
  return { db, key, snapshot };
}
type OldFacts = Record<string, unknown>[][];
/** Compare every original column; later added columns have separate expectations. */
export function oldFacts(db: DatabaseSync, original?: OldFacts): OldFacts {
  return ['execution_records', 'attempt_output_allocations', 'installation_storage_usage', 'runs', 'attempts', 'dispatch_outbox',
    'event_cursors', 'run_events', 'receipts'].map((table, index) => {
      const prior = original?.[index]?.[0]; const columns = prior ? Object.keys(prior).join(',') : '*';
      return db.prepare(`SELECT ${columns} FROM ${table}`).all();
    });
}
