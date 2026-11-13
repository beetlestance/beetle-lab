import type { NoTaskReceiptBinding,NoTaskReceipt } from '../no-task-receipt-values/index.js';
declare const observed:unique symbol;
export interface NoTaskObservation {readonly[observed]:true}
interface Facts {readonly owner:object;readonly binding:NoTaskReceiptBinding;readonly receipt:NoTaskReceipt;claimed:boolean;open():boolean}
const observations=new WeakMap<object,Facts>();
/** Internal native-owner mint; intentionally not re-exported by the public feature. */
export function mintNoTaskObservation(input:Omit<Facts,'claimed'>):NoTaskObservation{
 const token=Object.freeze({}) as NoTaskObservation;observations.set(token,{...input,claimed:false});return token;
}
/** One dispatch consumes the live native observation; unknown carrier termination retains its claim. */
export function claimNoTaskObservation(token:NoTaskObservation,owner:object){
 const facts=observations.get(token);if(!facts||facts.owner!==owner||facts.claimed||!facts.open())throw Error('Unavailable no-task observation');
 facts.claimed=true;return{binding:facts.binding,receipt:facts.receipt,release:()=>observations.delete(token)};
}
