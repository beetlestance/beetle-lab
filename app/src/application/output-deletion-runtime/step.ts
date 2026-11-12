import type {OutputDeletionFileKey} from '../../ports/output-deletion-metadata.js';
import type {OutputFileContext,OutputFileJob} from '../../ports/output-bytes.js';
import type {OutputDeletionRuntimeOptions} from './types.js';
import {deletionFile} from './values.js';
export async function deletionStep(options:OutputDeletionRuntimeOptions,key:OutputDeletionFileKey,context:OutputFileContext,
 own:<T>(job:OutputFileJob<T>)=>Promise<T>):Promise<void>{
 check(context);const file=deletionFile(await options.metadata.getFile(key),key);check(context);
 const intent={record:file.record,deletionId:file.deletionId,deletionVersion:file.deletionVersion};
 if(file.phase==='absent')return;
 if(file.phase==='pending_preparation'){
  const plan=await own(options.files.prepareRemoval(intent,context));check(context);
  deletionFile(await options.metadata.recordPlan({key,expectedVersion:file.version,plan}),key);
 }else{
  const plan={...intent,namespaceIdentity:file.namespaceIdentity!,preparationIdentity:file.preparationIdentity!};
  const receipt=await own(options.files.remove(plan,context));check(context);
  deletionFile(await options.metadata.recordAbsence({key,expectedVersion:file.version,receipt}),key);
 }
 check(context);
}
export function check(context:OutputFileContext):void{
 if(context.signal?.aborted)throw Error('Deletion interrupted');
 if(performance.now()>=context.deadline)throw Error('Deletion deadline');
}
