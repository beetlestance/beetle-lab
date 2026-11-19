import type { DatabaseSync } from 'node:sqlite';
import { initializePrior021 } from '../storage-settlement/prior021.js';
/** Synthetic fixture only: undo schema 027 when no reconciliation is recorded; never discard one. */
export function revert027(db:DatabaseSync):void{
 if(db.prepare('SELECT 1 FROM task_staging_namespaces WHERE reconciliation_json IS NOT NULL LIMIT 1').get())throw Error('Cannot discard a task reconciliation');
 const prior=initializePrior021(':memory:');
 try{
  const sql=prior.prepare("SELECT sql FROM sqlite_schema WHERE type='trigger' AND name='cleanup_plan_initial'").get()?.sql;
  if(typeof sql!=='string')throw Error('Missing historical cleanup plan trigger');
  db.exec('DROP TRIGGER task_reconciliation_guard;DROP TRIGGER cleanup_plan_initial;');db.exec(sql);
  db.exec('ALTER TABLE task_staging_namespaces DROP COLUMN reconciliation_json');
 }finally{prior.close();}
}
/** Schema 027 adds reconciliation_json as NULL; strip it so pre-existing columns compare exactly. */
export function withoutReconciliation(row:Record<string,unknown>):Record<string,unknown>{
 const{reconciliation_json:added,...rest}=row;if(added!==undefined&&added!==null)throw Error('Unexpected reconciliation');return rest;
}
