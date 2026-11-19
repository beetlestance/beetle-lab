import { expect, it } from 'vitest';
import { sealEngineResult } from '@beetle/contracts';
import { context, digest, fixture } from './fixture.js';
import { encodeComparison } from '../../src/application/run-comparison/serialize.js';
import { RUN_COMPARISON_BYTES, validateApi } from '@beetle/contracts/api';
import comparisonData from '../../../contracts/fixtures/api/valid/run-comparison.json' with {type:'json'};

function failed(reading=true,mismatch=false) {
 const f=fixture();const run=[...f.runs.values()][0]!;run.outcome='failed';
 const revision=f.revisions.get(run.revisionId)!;
 const config=revision.config as {loadPlan:{slos:unknown[]}};
 config.loadPlan.slos=[{id:'tail',metric:'http_req_duration',stat:'p99',operator:'<',value:300}];f.repin(0);
 const original=f.results.get(run.id)!.result!;const {seal,...body}=original;void seal;
 const result=sealEngineResult({...body,outcome:'failed',execution:{...body.execution,exitCode:99},thresholds:[{id:'tail',purpose:'slo',passed:false,
  ...(reading?{reading:{source:'native-summary',metric:'http_req_duration',stat:mismatch?'p95':'p99',value:322}}:{})}]},'2026-11-12T00:00:00.000Z',digest);
 if(!result.ok)throw Error('Invalid failed result fixture');f.results.get(run.id)!.result=result.value;
 return f;
}
it('projects the first native failed SLO and uniquely matched pinned limit without extra IO or config values',async()=>{
 const f=failed();f.config(0).requests[0]!.headers['X-Canary']='PRIVATE_VALUE_NOT_DISCLOSED';f.repin(0);
 const value=await f.service().compare(f.request,context());expect(value.items[0]!.result!.firstFailedSlo).toEqual({id:'tail',reading:{source:'native-summary',metric:'http_req_duration',stat:'p99',value:322},limit:{metric:'http_req_duration',stat:'p99',operator:'<',value:300}});
 expect(value.items[0]!.result!.slos).toEqual([{passed:false,...value.items[0]!.result!.firstFailedSlo}]);
 expect(JSON.stringify(value)).not.toContain('PRIVATE_VALUE_NOT_DISCLOSED');expect(f.calls.filter(call=>call.startsWith('revision:'))).toHaveLength(4);
});
it('keeps a legacy missing native reading explicit and refuses a mismatched reading limit',async()=>{
 const legacy=failed(false);expect((await legacy.service().compare(legacy.request,context())).items[0]!.result!.firstFailedSlo).toMatchObject({reading:null,limit:{stat:'p99',value:300}});
 const mismatch=failed(true,true);expect((await mismatch.service().compare(mismatch.request,context())).items[0]!.result!.firstFailedSlo).toMatchObject({reading:{stat:'p95'},limit:null});
});
it('preserves mandatory encoding at the unchanged cap by omitting optional detail, with at most two bounded attempts',()=>{
 const checked=validateApi('RunComparisonSnapshot',comparisonData);if(!checked.ok)throw Error('Invalid comparison fixture');const value=structuredClone(checked.value);
 const result=value.items[0]!.result!;result.firstFailedSlo={id:'tail',reading:{source:'native-summary',metric:'m'.repeat(128),stat:'p99',value:322},limit:null};
 result.slos=Array.from({length:256},(_,i)=>({id:'s'+i,passed:true,reading:result.firstFailedSlo!.reading,limit:null}));
 // Encoder-only boundary fixture; public run-note/schema validation is tested separately.
 const base=JSON.stringify(value);value.items[0]!.run.note='x'.repeat(RUN_COMPARISON_BYTES-Buffer.byteLength(base)+80);
 const encoded=encodeComparison(value);expect(Buffer.byteLength(encoded)).toBeLessThanOrEqual(RUN_COMPARISON_BYTES);
 const restored=JSON.parse(encoded);expect(restored.items[0].result.firstFailedSlo).toBeUndefined();expect(restored.items[0].result.slos).toBeUndefined();expect(restored.items[0].result.failedSloCount).toBe(result.failedSloCount);
});

it('projects passed native SLO facts without changing their verdict or adding reads',async()=>{
 const f=fixture();const source=[...f.results.values()][0]!.result!;
 const value=await f.service().compare(f.request,context());
 expect(value.items[0]!.result!.slos?.map(s=>({id:s.id,passed:s.passed,reading:s.reading}))).toEqual(source.thresholds.filter(s=>s.purpose==='slo').map(s=>({id:s.id,passed:s.passed,reading:s.reading??null})));
 expect(f.calls.filter(c=>c.startsWith('revision:'))).toHaveLength(4);
});
