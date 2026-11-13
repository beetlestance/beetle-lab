import type { DatabaseSync } from 'node:sqlite';
import type { SettingsScope } from '@beetle/contracts/api';
import { scopeKey,lower,boundedCopy } from './input.js';
import { StorageError } from './protocol.js';
interface Intent {readonly request:{readonly scope:SettingsScope;readonly requestId:string};readonly intentDigest:string}
/** Shared receipt-first transaction participant. No caller callback or transaction commit. */
export function readMutationReceipt(db:DatabaseSync,intent:Intent,maximum:number):{readonly kind:'missing'}|{readonly kind:'stored';readonly value:unknown}{
 if(!db.isTransaction)throw new StorageError('conflict');
 const receipt=db.prepare(`SELECT digest,CASE WHEN length(CAST(result_json AS BLOB))<=? THEN result_json ELSE NULL END result_json
  FROM receipts WHERE scope_key=? AND request_id=?`).get(maximum,scopeKey(intent.request.scope),lower(intent.request.requestId));
 if(!receipt)return{kind:'missing'};if(receipt.digest!==intent.intentDigest)throw new StorageError('conflict');
 if(typeof receipt.result_json!=='string')throw new StorageError('unavailable');return{kind:'stored',value:JSON.parse(receipt.result_json) as unknown};
}
export function writeMutationReceipt(db:DatabaseSync,intent:Intent,value:unknown,maximum:number):unknown{
 if(!db.isTransaction)throw new StorageError('conflict');const copy=boundedCopy(value,maximum);
 db.prepare('INSERT INTO receipts(scope_key,request_id,digest,result_json) VALUES(?,?,?,?)')
  .run(scopeKey(intent.request.scope),lower(intent.request.requestId),intent.intentDigest,JSON.stringify(copy));return copy;
}
