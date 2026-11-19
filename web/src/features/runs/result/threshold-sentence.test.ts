import { expect, it } from 'vitest';
import resultFixture from '../../../../../contracts/fixtures/valid/passed-result.json' with {type:'json'};
import type { EngineResult } from '@beetle/contracts';
import { thresholdSentence } from './threshold-sentence.js';
const result=resultFixture as EngineResult;
const rule={id:'latency',metric:'http_req_duration',stat:'p95',operator:'<' as const,value:400};
it('describes a failed native SLO reading only with its matched saved rule',()=>{
 const failed={...result,thresholds:[{id:'latency',purpose:'slo' as const,passed:false,reading:{source:'native-summary' as const,metric:'http_req_duration',stat:'p95' as const,value:512}}]};
 expect(thresholdSentence(failed,[rule])).toBe('p95 latency failed: 512 ms; limit under 400 ms.');
 for(const rules of [[],[rule,rule],[{...rule,stat:'p99'}]])expect(thresholdSentence(failed,rules)).toBe('Threshold latency failed.');
 expect(thresholdSentence({...failed,thresholds:[{id:'latency',purpose:'slo',passed:false}]},[rule])).toBe('Threshold latency failed.');
});
it('keeps native verdict authoritative even if a recorded value would appear to pass',()=>{
 expect(thresholdSentence({...result,thresholds:[{id:'latency',purpose:'slo',passed:false,reading:{source:'native-summary',metric:'http_req_duration',stat:'p95',value:0}}]},[rule])).toBe('p95 latency failed: 0 ms; limit under 400 ms.');
});
it('never calls a reached discovery trigger an SLO failure or declares no-SLO runs threshold-passed',()=>{
 const discovery={id:'discover',purpose:'discovery' as const,passed:false};
 expect(thresholdSentence({...result,thresholds:[discovery]})).toBeNull();
 expect(thresholdSentence({...result,thresholds:[discovery,{id:'latency',purpose:'slo',passed:true}]})).toBe('Every SLO threshold passed.');
 expect(thresholdSentence(null)).toBeNull();
});
