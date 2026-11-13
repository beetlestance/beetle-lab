import type {RunnerRetirementGateway} from '../../src/ports/runner-retirement.js';
import {vi} from 'vitest';
import {outputRetirementDigest} from '@beetle/contracts/output-retirement';
import type {RetirementReply} from '@beetle/contracts/output-retirement';
import type {OutputDeletionMetadata,OutputDeletionSummary} from '../../src/ports/output-deletion-metadata.js';
import {fixture as stored,cleaned,hash} from '../output-deletion/cleanup-ack/fixture.js';
import {fixture} from './fixture.js';
/** Synthetic retirement replies: driver ownership tests, not native cleanup proof. */
export function retirementFixture(){
 vi.useRealTimers();const source=stored();const f=fixture();const request=source.request();const reply=cleaned(request);
 const summary=source.store.execute({kind:'getOutputDeletion',key:source.key}) as OutputDeletionSummary;
 const metadata={scanRetirements:vi.fn<OutputDeletionMetadata['scanRetirements']>(async()=>({items:[summary],nextCursor:null})),
  reserveControl:vi.fn(async()=>summary),retirementRequest:vi.fn(async()=>request),
  recordCleanupAck:vi.fn(async()=>({version:1 as const,reply,replyDigest:hash(JSON.stringify(reply)),logicalBytes:1000}))};
 const gateway={retireOutput:vi.fn<RunnerRetirementGateway['retireOutput']>(async()=>({ok:true as const,value:reply}))};
 const {closure,...identity}=request;void closure;
 const actualPending:RetirementReply={...identity,state:'pending',retirementVersion:1,requestDigest:outputRetirementDigest(request,hash)};
 const {fileOnly,...base}=f.options;void fileOnly;
 const options={...base,retirement:{metadata,gateway,digest:hash}};vi.useFakeTimers();
 return {...f,options,metadata: {...f.metadata},retirement:metadata,gateway,request,reply,pending:actualPending,summary};
}
