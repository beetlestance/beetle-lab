import { mailboxVolumeName } from './live-channel.js';
import {captureRuntimeAssociation} from '../../runtime-association/index.js';
import type {RuntimeAssociation,RuntimeAssociationObservation,ObservedRuntimeAssociation} from '../../runtime-association/index.js';
import type {RuntimePlan} from './prepare.js';
import type {RetiredRuntimeBinding} from './retirement-binding.js';
export interface RuntimeAssociationPersistence {
 read():Promise<RuntimeAssociation|null>;
 commit(observed:ObservedRuntimeAssociation):Promise<RuntimeAssociation>;
}
const observations=new WeakMap<object,RuntimeAssociationObservation>();
const resumes=new WeakMap<object,object>();
export function observeRuntimeAssociation(plan:RuntimePlan,binding:RetiredRuntimeBinding):ObservedRuntimeAssociation{
 const labels=plan.spec.Labels;
 const original={organizationId:labels['dev.beetle.organization']!,workspaceId:labels['dev.beetle.workspace']!,attemptId:labels['dev.beetle.attempt']!,generation:1 as const,intentDigest:labels['dev.beetle.intent']!};
 const token=Object.freeze({}) as ObservedRuntimeAssociation;
 observations.set(token,Object.freeze({original:Object.freeze(original),daemonId:binding.daemonId,runtimeId:binding.runtimeId,specDigest:plan.specDigest,mailboxName:mailboxVolumeName(plan.name)}));return token;
}
/** Observation provenance only; not a mutable record constructor. */
export function runtimeAssociationObservationFacts(token:ObservedRuntimeAssociation):RuntimeAssociationObservation{
 const value=observations.get(token);if(!value)throw Error('Invalid runtime association observation');return value;
}
export function matchRuntimeAssociation(input:unknown,plan:RuntimePlan,binding:RetiredRuntimeBinding):RuntimeAssociation{
 const value=captureRuntimeAssociation(input);const expected=runtimeAssociationObservationFacts(observeRuntimeAssociation(plan,binding));
 for(const key of ['daemonId','runtimeId','specDigest','mailboxName'] as const)if(value[key]!==expected[key])throw Error('Runtime association mismatch');
 for(const key of ['organizationId','workspaceId','attemptId'] as const)if(value.original[key].toLowerCase()!==expected.original[key])throw Error('Runtime original mismatch');
 if(value.original.intentDigest!==expected.original.intentDigest)throw Error('Runtime intent mismatch');return value;
}
/** Internal resume capability is tied to this exact mailbox owner after trusted metadata read. */
export function resumeRuntimeAssociation(owner:object):object{const token=Object.freeze({});resumes.set(token,owner);return token;}
export function requireRuntimeAssociationResume(token:object,owner:object):void{if(resumes.get(token)!==owner)throw Error('Invalid runtime association resume');}
export function captureRuntimeAssociationPersistence(input:RuntimeAssociationPersistence|undefined):RuntimeAssociationPersistence|undefined{
 if(input===undefined)return undefined;
 return Object.freeze({read:input.read.bind(input),commit:input.commit.bind(input)});
}

interface AssociationMailbox{restoreAssociation(token:object):void}
export async function restoreRetiredAssociation(volume:AssociationMailbox|undefined,plan:RuntimePlan,binding:RetiredRuntimeBinding,persistence:RuntimeAssociationPersistence|undefined):Promise<void>{
 if(!volume||!persistence)return;const stored=await persistence.read();if(!stored)return;
 matchRuntimeAssociation(stored,plan,binding);volume.restoreAssociation(resumeRuntimeAssociation(volume));
}
export async function persistRetiredAssociation(volume:AssociationMailbox|undefined,plan:RuntimePlan,binding:RetiredRuntimeBinding,persistence:RuntimeAssociationPersistence|undefined):Promise<boolean>{
 if(!volume)return true;if(!persistence)return false;
 matchRuntimeAssociation(await persistence.commit(observeRuntimeAssociation(plan,binding)),plan,binding);return true;
}
