import assert from 'node:assert/strict';
import {join,basename} from 'node:path';
import {deliveryDigest,readDeliveryBytes} from '../../../delivery/files.js';
import {numericEvidence} from '../bounded-load/numeric.js';
import type {Assembly} from './assembly.js';
export async function artifacts(assembly:Assembly,key:Parameters<Assembly['journal']['readOutputSource']>[0]){
 const source=await assembly.journal.readOutputSource(key);assert(source);
 const result=source.manifest.result;assert('requiredAssertions' in result);assert.equal(result.completeness,'complete');
 assert.equal(result.outcome,'passed');assert.equal(result.execution.status,'completed');
 assert.deepEqual(result.requiredAssertions,{required:4,passed:4,failed:0,unknown:0});
 assert.equal(result.artifacts.length,8);let total=0;let numeric:ReturnType<typeof numericEvidence>|undefined;
 const checked=[];
 for(const item of result.artifacts){
  assert.equal(basename(item.relativePath),item.relativePath);total+=item.bytes;assert(total<=524288);
  const path=join(source.root.directory,item.relativePath);const actual=await deliveryDigest(path,524288);
  assert.deepEqual(actual,{bytes:item.bytes,sha256:item.sha256});checked.push({kind:item.kind,...actual});
  if(item.kind==='numeric-final')numeric=numericEvidence(JSON.parse((await readDeliveryBytes(path)).toString()),{...key,generation:1},4000);
 }
 assert(numeric);return {outcome:result.outcome,completeness:result.completeness,assertions:result.requiredAssertions,
  numeric,artifacts:checked,verifiedArtifactBytes:total,commonArtifactCeilingBytes:524288};
}
