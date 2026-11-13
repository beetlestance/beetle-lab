import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson,encodeJson } from '@beetle/contracts';
import { captureOutputRetirementRequest } from '@beetle/contracts/output-retirement';
import { captureNoTaskReceipt,captureStoredNoTaskReceipt,noTaskReceiptDigest } from '../../no-task-receipt-values/index.js';
import type { NoTaskReceiptBinding,StoredNoTaskReceipt } from '../../no-task-receipt-values/index.js';
import { rejectedCandidate } from '../rejected-controls/guard.js';
import { readInstalledNamespace } from '../staging-namespace/installed.js';
import { readRetirementIntent } from '../retirement/read.js';
import { retirementKey } from '../retirement/eligibility.js';
import { Failure,transaction } from '../sql.js';
import type { NoTaskReceiptOperation } from '../no-task-receipt-protocol.js';
interface Permit {readonly attemptId:string;readonly json:string;readonly digest:string}
const permits=new WeakMap<DatabaseSync,Permit>();
export function noTaskReceiptActive(db:DatabaseSync):boolean{return permits.has(db);}
export function registerNoTaskReceipt(db:DatabaseSync):void{
 db.function('no_task_receipt_insert_allowed',(attempt,json,digest)=>{
  const permit=permits.get(db);return permit?.attemptId===attempt&&permit.json===json&&permit.digest===digest?1:0;
 });
}
export function eligibleNoTaskReceiptBinding(db:DatabaseSync,input:unknown):NoTaskReceiptBinding{
 const request=captureOutputRetirementRequest(input);const facts=rejectedCandidate(db,request);
 if(!readRetirementIntent(db,retirementKey(request)))throw new Failure('conflict');
 const installed=readInstalledNamespace(db);if(installed?.state!=='bound')throw new Failure('conflict');
 return{request,namespaceIdentity:facts.control.namespaceIdentity,taskName:facts.control.taskName,
  daemonId:installed.intent.root.daemonId,root:installed.intent.root.native,markerDigest:installed.anchor.marker.sha256};
}
export function readNoTaskReceipt(db:DatabaseSync,expected:NoTaskReceiptBinding):StoredNoTaskReceipt|null{
 const request=captureOutputRetirementRequest(expected.request);
 const row=db.prepare(`SELECT CASE WHEN length(CAST(receipt_json AS BLOB))<=2048 THEN receipt_json END json,
  receipt_identity,charged_bytes FROM rejected_cleanup_receipts WHERE attempt_id=?`).get(request.attemptId);
 if(!row)return null;
 try{
  if(typeof row.json!=='string'||row.charged_bytes!==Buffer.byteLength(row.json)+512)throw Error();
  const stored=captureStoredNoTaskReceipt({receipt:JSON.parse(row.json) as unknown,receiptIdentity:row.receipt_identity},expected);
  if(encodeCanonicalJson(stored.receipt,2048)!==row.json)throw Error();return stored;
 }catch{throw new Failure('unavailable');}
}
function commit(db:DatabaseSync,expected:NoTaskReceiptBinding,input:unknown):StoredNoTaskReceipt{
 if(db.prepare('SELECT agent_settlement_active() active').get()?.active!==0)throw new Failure('conflict');
 let receipt:ReturnType<typeof captureNoTaskReceipt>;try{receipt=captureNoTaskReceipt(input,expected);}catch{throw new Failure('invalid_input');}
 const digest=noTaskReceiptDigest(receipt);const prior=readNoTaskReceipt(db,expected);
 if(prior){if(prior.receiptIdentity!==digest)throw new Failure('conflict');return prior;}
 const request=captureOutputRetirementRequest(expected.request);const json=encodeCanonicalJson(receipt,2048);
 permits.set(db,{attemptId:request.attemptId,json,digest});
 try{
  const changed=db.prepare(`INSERT INTO rejected_cleanup_receipts(attempt_id,request_digest,receipt_identity,receipt_json,charged_bytes)
   VALUES(?,?,?,?,?)`).run(request.attemptId,receipt.retirementRequestDigest,digest,json,Buffer.byteLength(json)+512).changes;
  if(changed!==1)throw new Failure('conflict');const stored=readNoTaskReceipt(db,expected);if(!stored)throw new Failure('unavailable');return stored;
 }finally{permits.delete(db);}
}
function capture(input:NoTaskReceiptOperation&{id:number}){
 const copy=JSON.parse(encodeJson(input,8192)) as NoTaskReceiptOperation&{id:number};
 if(!Number.isSafeInteger(copy.id)||copy.id<=0||!['noTaskReceiptRead','noTaskReceiptCommit'].includes(copy.kind)
  ||Object.keys(copy).sort().join(',')!=='id,json,kind'||typeof copy.json!=='string'||Buffer.byteLength(copy.json)>6144)throw Error();
 return captureBody(copy);
}
function captureBody(copy:NoTaskReceiptOperation){
 const body:unknown=JSON.parse(copy.json);if(!body||typeof body!=='object'||Array.isArray(body))throw Error();
 const row=body as Record<string,unknown>;const fields=copy.kind==='noTaskReceiptCommit'?'receipt,request':'request';
 if(Object.keys(row).sort().join(',')!==fields)throw Error();
 return{kind:copy.kind,request:captureOutputRetirementRequest(row.request),receipt:row.receipt};
}
export function executeNoTaskReceipt(db:DatabaseSync,input:NoTaskReceiptOperation&{id:number}):StoredNoTaskReceipt|null{
 let command:ReturnType<typeof capture>;try{command=capture(input);}catch{throw new Failure('invalid_input');}
 return transaction(db,()=>{const expected=eligibleNoTaskReceiptBinding(db,command.request);
  return command.kind==='noTaskReceiptRead'?readNoTaskReceipt(db,expected):commit(db,expected,command.receipt);});
}
