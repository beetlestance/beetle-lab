import type {DatabaseSync} from 'node:sqlite';
import {requireRule} from '../../../domain/namespaces/index.js';
export function nextExecutionOrder(db:DatabaseSync,purpose:'performance'|'standalone_export',attemptId:string):number {
 requireRule(db.isTransaction,'conflict');
 const value=db.prepare('INSERT INTO execution_orders(purpose,attempt_id) VALUES(?,?)').run(purpose,attemptId).lastInsertRowid;
 const order=Number(value);requireRule(Number.isSafeInteger(order)&&order>0,'capacity_unavailable');return order;
}
