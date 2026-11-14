import {DatabaseSync} from 'node:sqlite';
import {registerBackendSettlement} from '../../src/adapters/outbound/sqlite/backend-settlement-guard/index.js';
import {registerRetentionAccounting} from '../../src/adapters/outbound/sqlite/retention-accounting-guard/index.js';
import {registerCleanupAckValidation} from '../../src/adapters/outbound/sqlite/cleanup-ack-guard/index.js';
import {registerAbsenceValidation} from '../../src/adapters/outbound/sqlite/output-absence/values.js';
import {registerHistoryValidation} from '../../src/adapters/outbound/sqlite/run-history/values.js';
import {registerSearchFold} from '../../src/adapters/outbound/sqlite/run-search-fold.js';
/** Test-only NORMAL-lock contenders on a preinitialized database. Register the
 * actual production guard owners; never replace predicates with fake SQL functions.
 * This proves SQLite transaction contention, not multi-worker product support.
 */
export function rawConnection(path: string): DatabaseSync {
  const db = new DatabaseSync(path, {enableForeignKeyConstraints: true, timeout: 0});
  try {
    registerBackendSettlement(db); registerRetentionAccounting(db); registerCleanupAckValidation(db);
    registerAbsenceValidation(db); registerHistoryValidation(db); registerSearchFold(db); return db;
  } catch (error) {db.close(); throw error;}
}
