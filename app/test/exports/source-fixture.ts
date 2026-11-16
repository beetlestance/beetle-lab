import {createHash} from 'node:crypto';
import {sealStandaloneExportResult} from '@beetle/contracts';
import type {AttemptSnapshot,StandaloneExportResult} from '@beetle/contracts';
import {prepareOutputManifest,verifySourceEnvelope} from '@beetle/contracts/output-source';
import type {ExportOriginal,ExportControl} from '../../src/ports/exports.js';
import {uuid} from '../storage/fixture.js';
export const hash=(value:string|Uint8Array)=>createHash('sha256').update(value).digest('hex');
/** Synthetic protocol fixture only; it does not claim an actual admitted engine. */
export function sourceFixture(original:ExportOriginal,control:ExportControl,bytes:Uint8Array,status:'succeeded'|'failed'='succeeded'){
 if(control.binding===null)throw Error('Unbound fixture');const binding=control.binding;const expected=binding.expectation;
 const artifact={artifactId:uuid(900),kind:'standalone-k6-script' as const,relativePath:'standalone/suite.js' as const,
  bytes:bytes.length,sha256:hash(bytes),sealedAt:'2026-11-12T00:00:01.000Z'};
 const body={version:1 as const,purpose:'standalone_export' as const,exportId:expected.exportId,attemptId:expected.attemptId,
  organizationId:expected.organizationId,workspaceId:expected.workspaceId,generation:1 as const,assignmentDigest:expected.assignmentDigest,
  ...(status==='succeeded'?{status:'succeeded' as const,reason:null,artifact,buildUsage:{bytes:bytes.length,peakBytes:bytes.length}}:
  {status:'failed' as const,reason:'build_failed' as const,artifact:null,buildUsage:null})};
 const sealed=sealStandaloneExportResult(body,'2026-11-12T00:00:02.000Z',hash);if(!sealed.ok)throw Error('Synthetic result');
 const result=sealed.value as StandaloneExportResult;
 const manifest=prepareOutputManifest({version:1,binding:{...binding.key.attempt,journalAuthority:binding.journalAuthority,
  engine:original.assignment.offer.engine,installedIdentity:original.assignment.offer.installedIdentity,specDigest:'b'.repeat(64)},
  result,resultFileBytes:1024,controlBytes:0,verifiedBytes:1024+(status==='succeeded'?bytes.length:0)},hash);
 const envelope=verifySourceEnvelope({version:1,manifest,sourceDigest:'c'.repeat(64),closure:{version:1,finalAgentSeq:1,
  receipt:{version:1,journalAuthority:binding.journalAuthority,key:{organizationId:expected.organizationId,workspaceId:expected.workspaceId,
   attemptId:expected.attemptId,generation:1},manifestDigest:manifest.manifestDigest,sourceDigest:'c'.repeat(64)}}},hash);
 const snapshot:AttemptSnapshot={protocolVersion:'1.0',...binding.key.attempt,state:'exited',phase:'seal',lastSeq:1,retainedStartSeq:1,
  cancelRequested:false,admission:{state:'released',disposition:'settled'},exportResult:result};
 return {envelope,snapshot,result,binding};
}
