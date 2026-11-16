import {expect,it,vi} from 'vitest';
import type {AttemptSnapshot,OutputAbsence} from '@beetle/contracts';
import {prepareExportCancellation} from '../../src/application/exports/index.js';
import {reconcileExport} from '../../src/application/export-runtime/step.js';
import type {ExportRuntimeOptions} from '../../src/application/export-runtime/index.js';
import {OutputTransferError} from '../../src/ports/output-transfer.js';
import {storageFixture,seed,scope,digest,uuid} from '../storage/fixture.js';
import {createSuite,append,request} from '../storage/suites-fixture.js';
import {options,createCommand} from './fixture.js';
const f=storageFixture();
it.each(['rejected','never_started'] as const)('preserves exact absence settlement for %s without a source or script',async kind=>{
 const metadata=await f.open(f.path(),options());await seed(metadata);const body=request();body.config.secrets=[];
 const revision=await append(metadata,await createSuite(metadata),60,body);
 const job=await metadata.exports.create(createCommand(revision.id));const key={scope,id:job.id};
 const claim=await metadata.exportExecutions.claim(key);if(claim.kind==='blocked'||claim.control.binding===null)throw Error('claim');
 const binding=claim.control.binding;
 if(kind==='never_started')await metadata.exports.cancel(prepareExportCancellation({kind:'cancelExport',id:job.id,request:{scope,requestId:uuid(987)}},digest));
 const admission=kind==='rejected'?{state:'rejected' as const,reason:'controls_unavailable' as const}
  :{state:'released' as const,disposition:'never_started' as const};
 const snapshot:AttemptSnapshot={protocolVersion:'1.0',...binding.key.attempt,state:kind==='rejected'?'offered':'exited',phase:'validate',
  lastSeq:1,retainedStartSeq:1,cancelRequested:kind==='never_started',admission};
 const proof:OutputAbsence={version:1,...binding.key.attempt,journalAuthority:binding.journalAuthority,finalAgentSeq:1,admission,
  reason:kind==='rejected'?'unsupported_capability':'cancelled'};
 const absence=vi.fn(async()=>({ok:true as const,value:proof}));
 const executions=metadata.exportExecutions;
 const gateway:ExportRuntimeOptions['gateway']={output:()=>({absence,source:async()=>{throw Error('Unexpected source');},sourceChunk:async()=>{throw Error('Unexpected bytes');}}),
  exportAttempt:()=>({offerExport:async()=>({ok:true,value:snapshot}),cancelExportOriginal:async()=>({ok:true,value:snapshot}),
   snapshot:async()=>{throw Error('Unexpected snapshot');},events:async()=>{throw Error('Unexpected events');},ack:async()=>{throw Error('Unexpected ACK');}})};
 const transfer=vi.fn(()=>({result:Promise.reject(new OutputTransferError('source_absent')),settled:Promise.resolve()}));
 await reconcileExport({executions,outputs:metadata.exportOutputs,gateway,transfers:{transfer,close:async()=>{}},onFailure:async()=>{throw Error('Unexpected failure');}},key,new AbortController().signal);
 expect(absence).toHaveBeenCalledTimes(1);expect(transfer).toHaveBeenCalledTimes(1);
 expect(await metadata.exports.get(key)).toMatchObject({state:kind==='rejected'?'failed':'cancelled',artifact:null,
  reason:kind==='rejected'?'unsupported_capability':'cancelled'});
});
