import type { DatabaseSync } from 'node:sqlite';
import { requireFact } from '../retention-accounting/facts.js';
/** SQLite's internal sequence table cannot have user triggers; verify it explicitly. */
export function sequenceState(db:DatabaseSync){
 const rows=db.prepare('SELECT name,seq FROM sqlite_sequence ORDER BY name LIMIT 129').all();requireFact(rows.length<=128,'unavailable');
 const values=new Map<string,number>();for(const row of rows){requireFact(typeof row.name==='string'&&typeof row.seq==='number'&&Number.isSafeInteger(row.seq)&&row.seq>=0,'unavailable');values.set(row.name,row.seq);}return values;
}
export function expectedSequences(before:ReadonlyMap<string,number>,count:number){
 const expected=new Map(before);const prior=expected.get('output_deletion_intents')??0;requireFact(prior<=Number.MAX_SAFE_INTEGER-count);
 expected.set('output_deletion_intents',prior+count);return expected;
}
export function verifySequences(db:DatabaseSync,expected:ReadonlyMap<string,number>):void{
 const actual=sequenceState(db);requireFact(actual.size===expected.size);for(const[key,value]of expected)requireFact(actual.get(key)===value);
}
