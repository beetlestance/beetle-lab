import {getOrganizationOverview} from '../../../../application/organization-overview/index.js';
import type {FastifyInstance,onRequestAsyncHookHandler} from 'fastify';
import {getOverview} from '../../../../application/overview/index.js';
import type {OverviewReader,OrganizationOverviewReader} from '../../../../ports/overview.js';
import {registerApiOperation} from '../api-route.js';
export function registerOverviewRoute(server:FastifyInstance,options:{reader:OverviewReader;organizationReader?:OrganizationOverviewReader;authorize:onRequestAsyncHookHandler;now():string}):void{
 if(typeof options.authorize!=='function')throw Error('Overview authorization required');
 server.register(async scoped=>{
  scoped.addHook('onRequest',options.authorize);
  registerApiOperation(scoped,'getOrganizationOverview',({params})=>{
   if(!options.organizationReader)throw Error('Organisation overview unavailable');
   return getOrganizationOverview({scope:{kind:'organization',organizationId:params.organizationId},now:options.now()},options.organizationReader);
  });
  registerApiOperation(scoped,'getWorkspaceOverview',({params})=>getOverview({scope:{kind:'workspace',...params},now:options.now()},options.reader));
 });
}
