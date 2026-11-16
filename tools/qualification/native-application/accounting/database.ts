import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {deliveryDigest} from '../../../delivery/files.js';
export async function coldDatabase<T>(path:string,work:(db:DatabaseSync)=>T){
 const before=await deliveryDigest(path,16777216);const db=new DatabaseSync(path,{readOnly:true,timeout:1000,defensive:true});let result:T;
 try{db.exec('PRAGMA query_only=ON;BEGIN');assert.equal(db.prepare('PRAGMA query_only').get()!.query_only,1);result=work(db);assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);db.exec('ROLLBACK');}
 finally{db.close();assert.deepEqual(await deliveryDigest(path,16777216),before);}
 return {result,database:before};
}
