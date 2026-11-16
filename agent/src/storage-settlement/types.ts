import type { SettlementReply,SettlementRequest } from '@beetle/contracts/output-settlement';
import type { Journal } from '../journal/index.js';
import type { SettlementFence } from '../cleanup-access/index.js';
import type { Operation } from '../backends/docker/index.js';
export interface SettlementWork {readonly result:Promise<SettlementReply>;readonly settled:Promise<void>}
export interface SettlementOptions {readonly journal:Pick<Journal,'settlements'|'retirements'>}
export interface Entry {
 uncertain:boolean;issued:boolean;cancelled:boolean;fence?:SettlementFence;work?:SettlementWork;
 stop?:()=>void;
}
export interface Execution {readonly entry:Entry;readonly request:SettlementRequest;readonly operation:Operation}
export class StorageSettlementError extends Error {
 constructor(readonly reason:'closed'|'capacity'|'invalid_input'|'unavailable'){super(`Storage settlement ${reason}`);}
}
