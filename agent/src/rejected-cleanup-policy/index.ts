import { addResources,effectivePool,validResources } from '../admission/index.js';
import type { AdmissionSnapshot,Reservation } from '../admission/index.js';
import { rejectedCleanupLimits } from '../rejected-cleanup-values/index.js';
export interface RejectedFundingSnapshot extends Pick<AdmissionSnapshot,'configuration'|'observation'|'now'|'lastClock'> {
 readonly reservations:readonly Pick<Reservation,'status'|'resources'>[];
 readonly heldStagingBytes:number;readonly replayBytes:number;readonly cleanupBytes:number;readonly cleanupCount:number;
}
export type RejectedFundingDecision={readonly ok:true}|{readonly ok:false;readonly reason:'quota'|'capacity'|'capacity_unknown'};
function amount(value:number):void{if(!Number.isSafeInteger(value)||value<0)throw Error('Invalid funding counter');}
/** Subtraction preserves representable debt even after ceilings fall below it. */
function fitsDebt(limit:number,debts:readonly number[],request:number):boolean{
 amount(limit);let remaining=limit;
 for(const debt of debts){amount(debt);if(debt>remaining)return false;remaining-=debt;}
 return request<=remaining;
}
function fresh(snapshot:RejectedFundingSnapshot):boolean{
 const {now,lastClock,observation,configuration}=snapshot;
 amount(now);amount(lastClock);
 if(now<lastClock||!observation||observation.status!=='known')return false;
 return Number.isSafeInteger(observation.observedAt)&&observation.observedAt<=now&&observation.observedAt>=0
  &&now-observation.observedAt<=configuration.observationTtlMs;
}
function nativeDebt(snapshot:RejectedFundingSnapshot){
 if(snapshot.reservations.length>64)throw Error('Unbounded active funding snapshot');
 const staging:number[]=[];const writes:number[]=[];
 for(const reservation of snapshot.reservations){
  if(reservation.status!=='charged'||!validResources(reservation.resources))throw Error('Invalid active funding reservation');
  staging.push(reservation.resources.stagingBytes);writes.push(reservation.resources.outputBytes,reservation.resources.stagingBytes);
 }
 return{staging,writes};
}
/** New metadata debt only. The worker must derive this snapshot and positive rejection itself. */
export function decideRejectedFunding(snapshot:RejectedFundingSnapshot,original:{readonly usedBytes:number;readonly quotaBytes:number}):RejectedFundingDecision{
 amount(original.usedBytes);amount(original.quotaBytes);
 if(!fitsDebt(original.quotaBytes,[original.usedBytes],rejectedCleanupLimits.reservedBytes))return{ok:false,reason:'quota'};
 if(!fresh(snapshot))return{ok:false,reason:'capacity_unknown'};
 amount(snapshot.cleanupCount);amount(snapshot.cleanupBytes);amount(snapshot.heldStagingBytes);amount(snapshot.replayBytes);
 if(snapshot.cleanupCount>rejectedCleanupLimits.maximumFunded||snapshot.cleanupBytes!==snapshot.cleanupCount*rejectedCleanupLimits.reservedBytes)throw Error('Contradictory cleanup debt');
 if(snapshot.cleanupCount===rejectedCleanupLimits.maximumFunded)return{ok:false,reason:'capacity'};
 const observation=snapshot.observation!;
 const overhead=addResources(snapshot.configuration.controlReserve,snapshot.configuration.headroom);
 const pool=effectivePool(snapshot.configuration.pool,observation.capacity,overhead);const active=nativeDebt(snapshot);
 if(!fitsDebt(snapshot.heldStagingBytes,active.staging,0))throw Error('Active holds missing from funding counter');
 if(!fitsDebt(pool.stagingBytes,[snapshot.heldStagingBytes,snapshot.replayBytes,snapshot.cleanupBytes],rejectedCleanupLimits.reservedBytes))return{ok:false,reason:'capacity'};
 const native=[overhead.outputBytes,overhead.stagingBytes,snapshot.cleanupBytes,...active.writes];
 return fitsDebt(observation.freeDiskBytes,native,rejectedCleanupLimits.reservedBytes)?{ok:true}:{ok:false,reason:'capacity'};
}
