import type {OutputDeletionScan} from '../../../../ports/output-deletion-metadata.js';
import {progressCursor,progressPosition} from './progress-cursor.js';
import type {ProgressPosition} from './progress-cursor.js';
export type SettlementPosition=ProgressPosition;
export function settlementCursor(value:ProgressPosition,limit:number):string{return progressCursor(value,limit,'output-settlement-v1');}
export function settlementPosition(query:OutputDeletionScan){return progressPosition(query,'output-settlement-v1');}
