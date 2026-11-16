import { afterEach } from 'vitest';
import type { DatabaseSync } from 'node:sqlite';
import { encodeCanonicalJson } from '@beetle/contracts';
import type { RetirementRequest } from '@beetle/contracts/output-retirement';
import { retirementDigest } from '../../src/retirement-values/index.js';
import { initialize } from '../../src/journal/schema.js';
import { AdmissionStore } from '../../src/journal/admission-store.js';
import { admissionFixture,configuration,observation,now,scope } from '../admission/fixtures.js';
export function fundingFixture(){
 const f=admissionFixture();const databases=new Set<DatabaseSync>();
 afterEach(()=>{for(const db of databases)db.close();databases.clear();});
 async function ready(kind:'cancel'|'rejected'='cancel',quota?:number,second=false){
  const path=f.path();const journal=await f.configured(path,quota);const offer=f.job();const key=scope(offer);
  if(kind==='cancel')await journal.cancelOriginal({offer,now});
  else{
   await f.enqueue(journal,offer);const config=configuration();config.perRun.cpuMillis=500;
   await journal.admission({kind:'configure',configuration:config});await f.admit(journal,offer);
  }
  const proof=await journal.closeOutputAbsence(key);if(proof?.admission.state!=='rejected')throw Error('Missing actual rejection');
  await journal.acknowledge({protocolVersion:'1.0',...key,throughSeq:proof.finalAgentSeq});
  const request:RetirementRequest={version:1,purpose:'performance',...key,generation:1,intentDigest:offer.intentDigest,
   journalAuthority:await journal.journalAuthority(),runId:'00000000-0000-4000-8000-000000000201',
   deletionId:'00000000-0000-4000-8000-000000000202',deletionVersion:1,
   closure:{kind:'absence',proofDigest:retirementDigest(encodeCanonicalJson(proof,2048)),finalAgentSeq:proof.finalAgentSeq}};
  let secondRequest:RetirementRequest|undefined;
  if(second){
   const other=f.job(2);const otherKey=scope(other);await journal.cancelOriginal({offer:other,now});
   const otherProof=await journal.closeOutputAbsence(otherKey);if(!otherProof)throw Error('Missing second closure');
   secondRequest={...request,...otherKey,generation:1,intentDigest:other.intentDigest,
    closure:{kind:'absence',proofDigest:retirementDigest(encodeCanonicalJson(otherProof,2048)),finalAgentSeq:otherProof.finalAgentSeq}};
  }
  return{path,journal,offer,key,request,secondRequest};
 }
 async function native(kind:'cancel'|'rejected'='cancel',second=false){
  const value=await ready(kind,undefined,second);await f.close(value.journal);const db=initialize(value.path);databases.add(db);
  new AdmissionStore(db,67108864).execute({kind:'observe',observation:observation(Date.now())});return{...value,db};
 }
 return{...f,ready,native};
}
