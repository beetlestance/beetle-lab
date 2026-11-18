import {afterEach,beforeEach,expect,it,vi} from 'vitest';
import type {LiveMetricArchivePrefix,LiveMetricScope} from '@beetle/contracts/api';
import {fixture,window} from './fixtures.js';
beforeEach(()=>vi.useFakeTimers());afterEach(()=>{vi.clearAllTimers();vi.useRealTimers();});
function prefix(scope:LiveMetricScope):LiveMetricArchivePrefix{return {scope,windows:1,endTimeMs:2000,
 data:{artifactId:'00000000-0000-4000-8000-000000000005',relativePath:'metric-windows.ndjson',bytes:2048,sha256:'a'.repeat(64)},
 index:{artifactId:'00000000-0000-4000-8000-000000000006',relativePath:'metric-index.ndjson',bytes:1024,sha256:'b'.repeat(64)}};}
it('captures the latest completed archive evidence inside a new normal publication',async()=>{
 const base=fixture();const current=prefix(base.options.scope);await base.publisher.close();const f=fixture({archivePrefix:()=>current});
 f.publisher.accept(window(1));await f.advance();expect(f.frames[0]?.archivePrefix).toEqual(current);
 current.data.bytes=5000;expect(f.frames[0]?.archivePrefix?.data.bytes).toBe(2048);await f.publisher.close();
});
it.each(['throws','invalid'] as const)('preserves metrics and target readings when archive evidence %s',async kind=>{
 const f=fixture({target:{intervalMs:1000,recent:()=>[]},archivePrefix:()=>{if(kind==='throws')throw Error('Synthetic archive unavailable');return {...prefix(f.options.scope),windows:0};}});
 f.publisher.accept(window(1));await f.advance();expect(f.frames[0]?.archivePrefix).toBeUndefined();expect(f.frames[0]?.target).toBeDefined();expect(f.frames[0]?.series).toHaveLength(1);expect(f.publisher.state().reason).toBeNull();await f.publisher.close();
});
it('omits only archive evidence when it would exceed the remaining write budget',async()=>{
 const plain=fixture();plain.publisher.accept(window(1));await plain.advance();const budget=plain.write.mock.calls[0]![0].byteLength;await plain.publisher.close();
 const f=fixture({maximumProducedBytes:budget,archivePrefix:()=>prefix(f.options.scope)});f.publisher.accept(window(1));await f.advance();
 expect(f.write).toHaveBeenCalledTimes(1);expect(f.frames[0]?.archivePrefix).toBeUndefined();expect(f.frames[0]?.series).toHaveLength(1);expect(f.publisher.state().reason).toBeNull();await f.publisher.close();
});
