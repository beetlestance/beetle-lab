import { encodeCanonicalJson } from '@beetle/contracts';
import { producerBarrierFacts } from '../producer-retirement/index.js';
import type { ProducerBarrier } from '../producer-retirement/index.js';
import { retirementRoot,verifiedDaemonIdentity } from '../staging/index.js';
import { runtimeName } from '../backends/docker/index.js';
import { requireInventory } from '../task-inventory/index.js';
import type { OutputIO } from '../collection/output/index.js';
import type { NoTaskReceiptOptions } from './types.js';
export function noTaskScope(options:NoTaskReceiptOptions,token:ProducerBarrier){
 const intent=producerBarrierFacts(token,options.journal.retirements).intent;const root=retirementRoot(options.root);
 requireInventory(intent.task.state==='none'&&intent.request.closure.kind==='absence'&&intent.namespaceIdentity===root.namespaceIdentity);
 const {organizationId,workspaceId,attemptId,generation}=intent.request;const key={organizationId,workspaceId,attemptId,generation};
 const name=runtimeName({...intent.request,installationId:root.installationId});
 return{intent,root,key,name,daemonId:verifiedDaemonIdentity(options.root),directory:`${root.directory}/${name}`};
}
export async function currentNoTask(options:NoTaskReceiptOptions,token:ProducerBarrier,io:OutputIO){
 const scope=noTaskScope(options,token);const stored=await io.io(()=>options.journal.retirements.read(scope.key));
 const selected=await io.io(()=>options.journal.retirements.select(scope.intent.request));const current=selected.intent;
 const expected=encodeCanonicalJson(scope.intent,4096);
 requireInventory(encodeCanonicalJson(stored,4096)===expected&&encodeCanonicalJson(current,4096)===expected);
 return scope;
}
