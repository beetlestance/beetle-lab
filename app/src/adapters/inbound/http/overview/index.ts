import type {FastifyInstance,onRequestAsyncHookHandler} from 'fastify';
import {getOverview} from '../../../../application/overview/index.js';
import type {OverviewReader} from '../../../../ports/overview.js';
import {registerApiOperation} from '../api-route.js';
export function registerOverviewRoute(server:FastifyInstance,options:{reader:OverviewReader;authorize:onRequestAsyncHookHandler;now():string}):void{
 if(typeof options.authorize!=='function')throw Error('Overview authorization required');
 server.register(async scoped=>{
  scoped.addHook('onRequest',options.authorize);
  registerApiOperation(scoped,'getWorkspaceOverview',({params})=>getOverview({scope:{kind:'workspace',...params},now:options.now()},options.reader));
 });
}
