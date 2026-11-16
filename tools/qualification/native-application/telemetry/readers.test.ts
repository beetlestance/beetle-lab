import {expect,it,vi} from 'vitest';
import {readers} from './readers.js';
import type {Trial} from './assembly.js';
it('counts a bounded reader deadline as refusal and still joins every original on close',async()=>{
 const readLiveMetrics=vi.fn(async()=>({ok:false as const,reason:'deadline' as const}));
 const trial={supervisor:{readLiveMetrics}} as unknown as Trial;
 const key={organizationId:'11111111-1111-4111-8111-111111111111',workspaceId:'22222222-2222-4222-8222-222222222222',attemptId:'33333333-3333-4333-8333-333333333333',generation:1};
 const owner=readers(trial,key,true);await Promise.resolve();await Promise.resolve();
 expect(readLiveMetrics).toHaveBeenCalledTimes(3);
 const observations=await owner.close();expect(observations).toHaveLength(3);
 for(const row of observations)expect(row).toMatchObject({calls:1,frames:0,unavailable:1});
});
