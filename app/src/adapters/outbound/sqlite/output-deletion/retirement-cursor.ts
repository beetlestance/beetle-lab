import type {OutputDeletionScan} from '../../../../ports/output-deletion-metadata.js';
import {progressCursor,progressPosition} from './progress-cursor.js';
import type {ProgressPosition} from './progress-cursor.js';
export type RetirementPosition=ProgressPosition;
export function retirementCursor(value:ProgressPosition,limit:number):string{return progressCursor(value,limit,'output-retirement-v1');}
export function retirementPosition(query:OutputDeletionScan){return progressPosition(query,'output-retirement-v1');}
