import type { DatabaseSync } from 'node:sqlite';
import type { AgentSettlementTombstone } from '../../settlement-values/index.js';
import { rejectedCounters } from '../rejected-controls/capacity.js';
import { transferCounters,holdCounters,replayCounters } from './counters.js';
import type { ReplayCounters } from './counters.js';
import { Failure } from '../sql.js';
export function settlementCounters(db:DatabaseSync){return{hold:holdCounters(db),replay:replayCounters(db),rejected:rejectedCounters(db)};}
/** Rejected metadata transfers its actual prepaid control, leaving every hold counter unchanged. */
export function settlementTransfer(db:DatabaseSync,tombstone:AgentSettlementTombstone){
 const rejectedBefore=rejectedCounters(db);
 if(tombstone.version===1)return{...transferCounters(db,tombstone.disk),rejectedBefore,rejectedAfter:rejectedBefore};
 const holdBefore=holdCounters(db);const replayBefore=replayCounters(db);
 if(rejectedBefore[0]<1||replayBefore[1]>Number.MAX_SAFE_INTEGER-4096)throw new Failure('quota_exceeded');
 const replayAfter:ReplayCounters=[replayBefore[0]+1,replayBefore[1]+4096];
 const rejectedAfter:readonly[number,number,number]=[rejectedBefore[0]-1,rejectedBefore[1]-16384,rejectedBefore[2]];
 return{holdBefore,holdAfter:holdBefore,replayBefore,replayAfter,rejectedBefore,rejectedAfter};
}
