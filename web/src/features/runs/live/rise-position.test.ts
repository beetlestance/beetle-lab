import { expect,it } from 'vitest';
import { risePosition,measurementOrigin } from './rise-position.js';
import template from '../../../../../contracts/fixtures/api/valid/run-metric-overview.json' with {type:'json'};
import type {RunMetricOverview} from '@beetle/contracts/api';
const source={generation:1,manifestDigest:'a'.repeat(64)};
const origin={...source,measurementSourceTimeMs:1800000000000};
it('subtracts only a matching native marker and keeps unknown or foreign origins as source timestamps',()=>{
 expect(risePosition(1800000400000,source,origin)).toBe('06:40 into recorded engine execution');
 for(const unknown of [undefined,{...origin,manifestDigest:'b'.repeat(64)},{...origin,generation:2},{...origin,measurementSourceTimeMs:1800000500000}]){
  expect(risePosition(1800000400000,source,unknown)).toBe('Recorded source timestamp 1800000400000 ms');
 }
});
it('refuses absent and legacy marker sources',()=>{
 expect(measurementOrigin(null)).toBeUndefined();
 expect(measurementOrigin({...template,availability:'ready',source:{...origin,numericVersion:3}} as RunMetricOverview)).toBeUndefined();
});
