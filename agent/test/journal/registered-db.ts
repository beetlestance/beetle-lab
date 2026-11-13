import { DatabaseSync } from 'node:sqlite';
import { registerSettlementGuard } from '../../src/journal/settlement-guard/index.js';
/** Fault-injection connections need the real connection-local guard functions too.
 * Registration never opens a permit; all destructive authorization stays refused. */
export function registeredDatabase(...input:ConstructorParameters<typeof DatabaseSync>):DatabaseSync{
 const db=new DatabaseSync(...input);registerSettlementGuard(db);return db;
}
