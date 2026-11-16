import type {FastifyInstance,onRequestAsyncHookHandler} from 'fastify';
import type {WorkspaceScope} from '@beetle/contracts/api';
import type {ExportStore,ExportArtifacts} from '../../../../ports/exports.js';
import type {OutputByteStore} from '../../../../ports/output-bytes.js';
import type {OutputBinding} from '../../../../domain/output-owner/index.js';
import type {IntentDigest} from '../../../../application/namespaces/index.js';
import {createExport,cancelExport,getExport,listExports} from '../../../../application/exports/index.js';
import {requireRule,sameScope,sameUuid} from '../../../../domain/namespaces/index.js';
import {registerApiOperation} from '../api-route.js';
import {registerExportContent} from './content.js';
interface Options {
 readonly store:ExportStore;readonly outputs:Pick<ExportArtifacts,'published'>;
 readonly bytes?:Pick<OutputByteStore<OutputBinding>,'read'>;
 readonly newId:()=>string;readonly now:()=>string;readonly digest:IntentDigest;readonly authorize:onRequestAsyncHookHandler;
}
export const exportScope=(params:{organizationId:string;workspaceId:string}):WorkspaceScope=>({kind:'workspace',organizationId:params.organizationId,workspaceId:params.workspaceId});
export function registerExportRoutes(server:FastifyInstance,options:Options):{close():Promise<void>}{
 if(typeof options.authorize!=='function')throw new Error('Export authorization required');
 server.register(async scoped=>{
  scoped.addHook('onRequest',options.authorize);
  registerApiOperation(scoped,'createExport',({params,body})=>{
   requireRule(sameScope(exportScope(params),body.scope)&&sameUuid(params.revisionId,body.revisionId),'not_found');
   return createExport({kind:'createExport',id:options.newId(),attemptId:options.newId(),requestedAt:options.now(),request:body},options.digest,options.store);
  },{bodyLimit:65536});
  registerApiOperation(scoped,'cancelExport',({params,body})=>{
   requireRule(sameScope(exportScope(params),body.scope),'not_found');
   return cancelExport({kind:'cancelExport',id:params.exportId,request:body},options.digest,options.store);
  },{bodyLimit:65536});
  registerApiOperation(scoped,'getExport',({params})=>getExport({scope:exportScope(params),id:params.exportId},options.store));
  registerApiOperation(scoped,'listExports',({params,query})=>listExports({scope:exportScope(params),...query},options.store));
  registerApiOperation(scoped,'getExportProfiles',({params})=>options.store.profiles(exportScope(params)));
 });
 return registerExportContent(server,options);
}
