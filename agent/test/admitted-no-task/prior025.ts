/** Genuine historical025 objects, built from frozen migrations; fixture only. */
import { initializePrior021 } from '../storage-settlement/prior021.js';
import { registerSettlementGuard } from '../../src/journal/settlement-guard/index.js';
import { registerRejectedFunding } from '../../src/journal/rejected-controls/guard.js';
import { registerNoTaskReceipt } from '../../src/journal/no-task-receipts/store.js';
import { migration022 } from '../../src/journal/migration022.js';
import { migration023 } from '../../src/journal/migration023.js';
import { migration024 } from '../../src/journal/migration024.js';
import { migration025 } from '../../src/journal/migration025.js';
import { transaction } from '../../src/journal/sql.js';
export function prior025(){
 const db=initializePrior021(':memory:');registerSettlementGuard(db);registerRejectedFunding(db);registerNoTaskReceipt(db);
 transaction(db,()=>{for(const sql of [migration022,migration023,migration024,migration025])db.exec(sql);});return db;
}
