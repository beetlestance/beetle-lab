import { expect,it } from 'vitest';
import request from '../../../contracts/fixtures/valid/output-retirement-absence.json' with {type:'json'};
import { makeNoTaskReceipt,captureNoTaskReceipt,noTaskReceiptDigest,captureStoredNoTaskReceipt } from '../../src/no-task-receipt-values/index.js';
import type { NoTaskReceiptBinding } from '../../src/no-task-receipt-values/index.js';
const binding:NoTaskReceiptBinding={request,namespaceIdentity:'a'.repeat(64),taskName:'beetle-task',daemonId:'synthetic-daemon',
 root:{dev:'1',ino:'2',uid:'10001',gid:'10001',mode:String(0o40700)},markerDigest:'b'.repeat(64)};
it('owns a bounded immutable no-task commitment without synthetic prepared roles',()=>{
 const receipt=makeNoTaskReceipt(binding);expect(Buffer.byteLength(JSON.stringify(receipt))+512).toBeLessThanOrEqual(2560);
 expect(captureNoTaskReceipt(receipt,binding)).toEqual(receipt);expect(Object.isFrozen(receipt)).toBe(true);
 expect(receipt.preparationIdentity).toBe('39e85549fb804b8c3a7a1d8358e82f0c4dc7dd3bdcb853b01f5179da92ac4d84');
 expect(noTaskReceiptDigest(receipt)).toBe('45c0602311b936049b36750600643b3389c20b57aeaf2c39c666cf808788a14a');
 expect(receipt.preparationIdentity).toMatch(/^[a-f0-9]{64}$/);expect(receipt.preparationIdentity).not.toBe(noTaskReceiptDigest(receipt));
 const stored={receipt,receiptIdentity:noTaskReceiptDigest(receipt)};expect(captureStoredNoTaskReceipt(stored,binding)).toEqual(stored);
});
it('rejects request/native/daemon/marker substitutions, extras and forged stored hashes',()=>{
 const receipt=makeNoTaskReceipt(binding);
 for(const changed of [{...receipt,taskName:'other'},{...receipt,daemonId:'other'},{...receipt,markerDigest:'c'.repeat(64)},
  {...receipt,root:{...receipt.root,ino:'3'}},{...receipt,retirementRequestDigest:'f'.repeat(64)},{...receipt,extra:true}]){
  expect(()=>captureNoTaskReceipt(changed,binding)).toThrow();
 }
 expect(()=>captureStoredNoTaskReceipt({receipt,receiptIdentity:'f'.repeat(64)},binding)).toThrow();
 expect(()=>makeNoTaskReceipt({...binding,daemonId:'bad/name'})).toThrow();
});
