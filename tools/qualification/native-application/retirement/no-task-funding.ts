import assert from 'node:assert/strict';
import type { settledAgent } from './settlement-storage.js';
import { record } from './metadata.js';
/** Independent mode assertions against the canonical, request-bound durable tombstone. */
export function assertNoTaskFunding(mode:'rejected'|'admitted',body:ReturnType<typeof settledAgent>['body'],seed:unknown){
 if(mode==='rejected'){
  assert.equal(body.version,2);assert('funding'in body);assert.deepEqual(body.funding,{kind:'rejected_control',reservedBytes:16384});
  assert.deepEqual(body.disk,{outputBytes:0,stagingBytes:0});
  for(const key of ['cleanupControlBytes','holdBytes','collectionBytes','sourceBytes','deliveryBytes'] as const)assert.equal(body.charges[key],0);
 }else{
  assert.equal(body.version,1);assert.equal(body.charges.cleanupControlBytes,196608);assert.equal(body.charges.holdBytes,512);
  const durable=record(record(seed)?.durable);const disk=record(durable?.disk);assert(disk);
  assert.deepEqual(body.disk,{outputBytes:disk.output_bytes,stagingBytes:disk.staging_bytes});
 }
}
