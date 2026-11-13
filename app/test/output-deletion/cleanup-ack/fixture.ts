import { outputRetirementDigest } from '@beetle/contracts/output-retirement';
import type { RetirementRequest,RetirementReply } from '@beetle/contracts/output-retirement';
import { ready,begin,file,plan } from '../fixture.js';
import { hash } from '../../storage/output-payload-fixtures.js';
export { hash } from '../../storage/output-payload-fixtures.js';
export function cleaned(request:RetirementRequest):RetirementReply{
 const {closure,...identity}=request;void closure;
 return {...identity,state:'cleaned',retirementVersion:1,requestDigest:outputRetirementDigest(request,hash),
  namespaceIdentity:'a'.repeat(64),preparationIdentity:'b'.repeat(64),cleanupReceiptDigest:'c'.repeat(64)};
}
/** Synthetic producer replies for metadata tests; not native cleanup evidence. */
export function fixture(count=0){const f=ready(count);const {key}=begin(f);
 const finishFiles=()=>{for(let ordinal=0;ordinal<count;ordinal++){
  const native=plan(file(f,key,ordinal));const owned={key:{...key,ordinal}};
  f.store.execute({kind:'recordOutputDeletionPlan',request:{...owned,expectedVersion:1,plan:native}});
  f.store.execute({kind:'recordOutputDeletionAbsence',request:{...owned,expectedVersion:2,receipt:{...native,phase:'absent'}}});
 }};
 const request=()=>f.store.execute({kind:'getOutputRetirementRequest',key}) as RetirementRequest;
 const read=()=>f.store.execute({kind:'getOutputCleanupAck',key});
 const record=(reply=cleaned(request()))=>f.store.execute({kind:'recordOutputCleanupAck',request:{key,reply}});
 return {...f,key,request,read,record,finishFiles};
}
export function preserved(f:ReturnType<typeof fixture>){
 const names=['runs','attempts','execution_records','attempt_output_allocations','execution_output_sources','execution_output_payloads',
  'execution_output_slots','execution_output_finalizations','event_cursors','run_events','installation_storage_usage','backend_cleanup_controls','output_deletion_intents','output_deletion_files','receipts'];
 return JSON.stringify(names.map(table=>({table,rows:f.db.prepare(`SELECT * FROM ${table} LIMIT 130`).all()})));
}
