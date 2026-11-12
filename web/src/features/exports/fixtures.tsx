import {render} from '@testing-library/react';
import {QueryClientProvider} from '@tanstack/react-query';
import type {ReactNode} from 'react';
import type {ApiClient,CreateExportRequest,ExportJob} from '@beetle/contracts/api';
import {ApiContext} from '../../app/api.js';
import {createQueryClient} from '../../app/queries.js';
import {revision,settings,run,runId} from '../runs/test-fixtures.js';
export {revision,runId};
export {testClient,json,deferred,ids} from '../../app/test-fixtures.js';
export function exportSettings(){
 const value=settings();value.effective.runDefaults.budget.outputBytes={...value.effective.runDefaults.budget.outputBytes,value:2097152,allowedRange:{minimum:1,maximum:4194304}};return value;
}
export function exportJob(body?:CreateExportRequest):ExportJob{
 const source=run();return {id:runId,scope:source.scope,version:1,suiteId:source.suiteId,revisionId:source.revisionId,revisionDigest:source.revisionDigest,
  activeAttemptId:source.activeAttemptId,requestedAt:source.requestedAt,state:'queued',cancellationRequested:false,reason:null,
  engine:{...source.engine,profileId:'k6-export'},sourceProfileId:body?.engineProfile??'k6',budget:body?.budget??source.budget,
  executionPolicy:body?.executionPolicy??source.executionPolicy,settingsVersions:source.settingsVersions,
  options:body?.options??{maximumBuildBytes:1048576,scriptTimeoutMs:180000},artifact:null};
}
export function environment(api:ApiClient){
 const client=createQueryClient();
 function Frame({children}:{children:ReactNode}){return <ApiContext.Provider value={api}><QueryClientProvider client={client}>{children}</QueryClientProvider></ApiContext.Provider>;}
 return {client,Frame,mount:(node:ReactNode)=>render(<Frame>{node}</Frame>)};
}
