import { expect,it } from 'vitest';
import { configuration,observation,now } from '../admission/fixtures.js';
import { decideRejectedFunding } from '../../src/rejected-cleanup-policy/index.js';
import type { RejectedFundingSnapshot } from '../../src/rejected-cleanup-policy/index.js';
function snapshot():RejectedFundingSnapshot{return{configuration:configuration(),observation:observation(),now,lastClock:now,
 reservations:[],heldStagingBytes:0,replayBytes:0,cleanupBytes:0,cleanupCount:0};}
const original={usedBytes:500,quotaBytes:20000};
it('reserves exact original and global boundaries without changing intrinsic execution admission',()=>{
 const state=snapshot();state.configuration.pool.stagingBytes=16384;expect(decideRejectedFunding(state,original)).toEqual({ok:true});
 state.configuration.pool.stagingBytes=16383;expect(decideRejectedFunding(state,original)).toEqual({ok:false,reason:'capacity'});
 expect(decideRejectedFunding(snapshot(),{usedBytes:500,quotaBytes:16884})).toEqual({ok:true});
 expect(decideRejectedFunding(snapshot(),{usedBytes:500,quotaBytes:16883})).toEqual({ok:false,reason:'quota'});
 expect(decideRejectedFunding(snapshot(),{usedBytes:100,quotaBytes:1024})).toEqual({ok:false,reason:'quota'});
});
it.each(['unknown','stale','future','rollback'] as const)('protects debt when capacity is %s',kind=>{
 const base=snapshot();const value=base.observation!;
 const state={...base,...(kind==='rollback'?{lastClock:now+1}:{}),observation:{...value,
  ...(kind==='unknown'?{status:'unknown' as const}:{}),...(kind==='stale'?{observedAt:now-1001}:{}),...(kind==='future'?{observedAt:now+1}:{})}};
 expect(decideRejectedFunding(state,original)).toEqual({ok:false,reason:'capacity_unknown'});
});
it('counts temporary controls and replay when no disk hold remains, including full and lower ceilings',()=>{
 const base=snapshot();const state={...base,cleanupCount:1,cleanupBytes:16384,replayBytes:4096};state.configuration.pool.stagingBytes=16384*2+4096;
 expect(decideRejectedFunding(state,original)).toEqual({ok:true});state.configuration.pool.stagingBytes--;
 expect(decideRejectedFunding(state,original)).toEqual({ok:false,reason:'capacity'});
 expect(decideRejectedFunding({...snapshot(),cleanupCount:64,cleanupBytes:64*16384},original)).toEqual({ok:false,reason:'capacity'});
 expect(decideRejectedFunding({...snapshot(),heldStagingBytes:Number.MAX_SAFE_INTEGER,replayBytes:4096},original)).toEqual({ok:false,reason:'capacity'});
});
it('enforces conservative native-free safety without subtracting retained physical files again',()=>{
 const base=snapshot();const state={...base,heldStagingBytes:5000,observation:{...base.observation!,freeDiskBytes:16384}};
 expect(decideRejectedFunding(state,original)).toEqual({ok:true});state.observation.freeDiskBytes--;
 expect(decideRejectedFunding(state,original)).toEqual({ok:false,reason:'capacity'});
});
it('refuses contradictory and unsafe accounting rather than clamping it into apparent free capacity',()=>{
 expect(()=>decideRejectedFunding({...snapshot(),cleanupCount:1,cleanupBytes:0},original)).toThrow();
 expect(()=>decideRejectedFunding({...snapshot(),replayBytes:Infinity},original)).toThrow();
 expect(()=>decideRejectedFunding({...snapshot(),heldStagingBytes:-1},original)).toThrow();
});

it('charges active future writes once and refuses a hold counter that omits an active staging promise',()=>{
 const base=snapshot();const state={...base,heldStagingBytes:25000,
  reservations:[{status:'charged' as const,resources:{cpuMillis:100,memoryBytes:100,pids:1,outputBytes:1000,stagingBytes:20000}}],
  observation:{...base.observation!,freeDiskBytes:37384}};
 expect(decideRejectedFunding(state,original)).toEqual({ok:true});state.observation.freeDiskBytes--;
 expect(decideRejectedFunding(state,original)).toEqual({ok:false,reason:'capacity'});
 expect(()=>decideRejectedFunding({...state,heldStagingBytes:19999},original)).toThrow('Active holds missing');
});

it('reserves native space for existing cleanup promises before funding another original',()=>{
 const base=snapshot();const state={...base,cleanupCount:1,cleanupBytes:16384,observation:{...base.observation!,freeDiskBytes:32768}};
 expect(decideRejectedFunding(state,original)).toEqual({ok:true});state.observation.freeDiskBytes--;
 expect(decideRejectedFunding(state,original)).toEqual({ok:false,reason:'capacity'});
});
