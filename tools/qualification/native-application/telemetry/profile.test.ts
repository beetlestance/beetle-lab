import {expect,it} from 'vitest';
import {createEngineCatalog} from '../../../../agent/src/catalog/index.js';
import {registration} from '../../../../agent/test/catalog/fixtures.js';
import {catalog,backend} from './profile.js';
it('admits both benchmark modes through the real catalog schema with identical resource reservations',()=>{
 const base=registration();const source=createEngineCatalog([{...base,profile:{...base.profile,liveMetricMailbox:true}}]);
 const on=catalog(source,'on').engines[0]!;const off=catalog(source,'off').engines[0]!;
 expect(on.profile.entrypoint.executable).toBe('env');expect(off.profile.entrypoint.executable).toBe('env');
 expect(on.profile.entrypoint.arguments[0]).toBe('BEETLE_K6_LIVE_METRICS_V2=1');
 expect(off.profile.entrypoint.arguments.slice(0,2)).toEqual(['-u','BEETLE_K6_LIVE_METRICS_V2']);
 expect(off.profile.maximumBudget).toEqual(on.profile.maximumBudget);expect(off.profile.tmpfsBytes).toBe(on.profile.tmpfsBytes);
 expect(off.profile.liveMetricMailbox).toBe(true);expect(on.profile.liveMetricMailbox).toBe(true);
 expect(off.profile.effectiveImage).toEqual(on.profile.effectiveImage);expect(off.approved).toEqual(on.approved);
 expect(off.installedIdentity).not.toEqual(on.installedIdentity);
});
it('masks only optional sampling and live reads while retaining the same control operations',()=>{
 const transport={request:async()=>({ok:false as const,reason:'unavailable' as const,dispatched:false})};
 const on=backend(transport,'on');const off=backend(transport,'off');
 expect(typeof on.sampleResources).toBe('function');expect(typeof on.readMailbox).toBe('function');
 expect(off.sampleResources).toBeUndefined();expect(off.readMailbox).toBeUndefined();
 for(const field of ['ensureCreated','dispatchStartOnce','inspect','stop','kill'] as const){expect(typeof off[field]).toBe('function');expect(typeof on[field]).toBe('function');}
});
