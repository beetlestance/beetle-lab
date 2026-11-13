import type { FastifyInstance,onRequestAsyncHookHandler } from 'fastify';
import type { WorkspaceScope } from '@beetle/contracts/api';
import type { RetentionMetadata } from '../../../../ports/retention.js';
import { requireRule,sameScope } from '../../../../domain/namespaces/index.js';
import { retentionPreview } from '../../../../application/retention/index.js';
import { registerApiOperation } from '../api-route.js';
interface Options {
 readonly store:RetentionMetadata;readonly authorize:onRequestAsyncHookHandler;
 newId():string;now():string;
}
function scope(params:{organizationId:string;workspaceId:string}):WorkspaceScope{
 return{kind:'workspace',organizationId:params.organizationId,workspaceId:params.workspaceId};
}
/** Authenticated metadata-only maintenance; native originals stay owned by the driver. */
export function registerRetentionRoutes(server:FastifyInstance,options:Options):void{
 if(typeof options.authorize!=='function')throw new Error('Retention authorization guard required');
 const dependencies=Object.freeze({...options});const store=dependencies.store;
 server.register(async scoped=>{
  scoped.addHook('onRequest',dependencies.authorize);
  registerApiOperation(scoped,'previewWorkspaceRetention',async({params,body})=>{
   requireRule(body.scope.kind==='workspace'&&sameScope(scope(params),body.scope),'not_found');
   return retentionPreview(await store.preview({id:dependencies.newId(),capturedAt:dependencies.now(),request:{...body,scope:scope(params)}}));
  },{bodyLimit:12288});
  registerApiOperation(scoped,'applyWorkspaceRetention',async({params,body})=>{
   requireRule(body.scope.kind==='workspace'&&sameScope(scope(params),body.scope),'not_found');
   return store.apply({id:dependencies.newId(),appliedAt:dependencies.now(),request:{...body,scope:scope(params)}});
  },{bodyLimit:12288});
  registerApiOperation(scoped,'previewRunDeletion',async({params,body})=>{
   requireRule(sameScope(scope(params),body.scope)&&params.runId.toLowerCase()===body.runId.toLowerCase(),'not_found');
   return retentionPreview(await store.previewRun({id:dependencies.newId(),capturedAt:dependencies.now(),request:{...body,scope:scope(params)}}));
  },{bodyLimit:4096});
  registerApiOperation(scoped,'getWorkspaceRetentionPreview',async({params})=>retentionPreview(await store.getPreview({scope:scope(params),id:params.snapshotId.toLowerCase()})));
  registerApiOperation(scoped,'listWorkspaceRetention',async({params})=>{const value=await store.list(scope(params));return{...value,items:value.items.map(item=>({...item}))};});
  registerApiOperation(scoped,'getWorkspaceRetentionStatus',async({params})=>{const value=await store.get({scope:scope(params),id:params.snapshotId.toLowerCase()},Date.parse(dependencies.now()));return{...value,items:value.items.map(item=>({...item}))};});
  registerApiOperation(scoped,'discardWorkspaceRetention',async({params})=>store.discard({scope:scope(params),id:params.snapshotId.toLowerCase()},Date.parse(dependencies.now())));
 });
}
