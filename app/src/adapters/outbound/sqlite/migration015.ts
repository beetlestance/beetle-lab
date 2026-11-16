import {exportSchema} from './export-jobs/schema.js';
import {exportGuards} from './export-jobs/guards.js';
/** Independent export jobs share order/storage policy, never a synthetic Run. */
export const migration015=`
CREATE TABLE execution_orders (
 queue_order INTEGER PRIMARY KEY AUTOINCREMENT CHECK(queue_order BETWEEN 1 AND 9007199254740991),
 purpose TEXT NOT NULL CHECK(purpose IN ('performance','standalone_export')),attempt_id TEXT NOT NULL UNIQUE);
INSERT INTO execution_orders(queue_order,purpose,attempt_id)
 SELECT queue_order,'performance',attempt_id FROM execution_intents ORDER BY queue_order;
CREATE TRIGGER execution_order_no_replace BEFORE INSERT ON execution_orders
 WHEN EXISTS(SELECT 1 FROM execution_orders WHERE attempt_id=NEW.attempt_id OR queue_order=NEW.queue_order)
 BEGIN SELECT RAISE(ABORT,'retained execution order');END;
CREATE TRIGGER execution_order_immutable BEFORE UPDATE ON execution_orders BEGIN SELECT RAISE(ABORT,'immutable execution order');END;
CREATE TRIGGER execution_order_retained BEFORE DELETE ON execution_orders BEGIN SELECT RAISE(ABORT,'retained execution order');END;
CREATE TRIGGER run_execution_order BEFORE INSERT ON execution_intents
 WHEN NOT EXISTS(SELECT 1 FROM execution_orders WHERE queue_order=NEW.queue_order AND attempt_id=NEW.attempt_id AND purpose='performance')
 BEGIN SELECT RAISE(ABORT,'run order mismatch');END;
${exportSchema}
${exportGuards}
PRAGMA user_version=15;`;
