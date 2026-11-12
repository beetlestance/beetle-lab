import type {FastifyInstance,onRequestAsyncHookHandler} from 'fastify';
import {validateApi,EXPORT_CONTENT_ROUTE} from '@beetle/contracts/api';
import type {ExportArtifacts} from '../../../../ports/exports.js';
import type {OutputByteStore} from '../../../../ports/output-bytes.js';
import type {OutputBinding} from '../../../../domain/output-owner/index.js';
import {RequestLifetimes} from '../request-lifetimes/index.js';
import {ApiFault,apiErrorResponse} from '../api-errors.js';
import {header,selectRange} from '../byte-content.js';
import {sendArtifact} from '../artifact-content/index.js';
interface Options {readonly outputs:Pick<ExportArtifacts,'published'>;readonly bytes?:Pick<OutputByteStore<OutputBinding>,'read'>;readonly authorize:onRequestAsyncHookHandler}
export function registerExportContent(server:FastifyInstance,options:Options):{close():Promise<void>}{
 const owners=new RequestLifetimes(1);
 server.register(async scoped=>{
  owners.register(scoped);scoped.addHook('onRequest',options.authorize);
  scoped.route({method:'GET',url:EXPORT_CONTENT_ROUTE,exposeHeadRoute:false,handler:async(request,reply)=>{
   const parsed=validateApi('ExportParams',request.params);
   if(!parsed.ok||Object.keys(request.query as object).length!==0||request.raw.httpVersion!=='1.1'
    ||header(request,'transfer-encoding')!==undefined||![undefined,'0'].includes(header(request,'content-length')))throw new ApiFault('malformed_request');
   const params=parsed.value;const owner=owners.forRequest(request);const bytes=options.bytes;
   if(!bytes)throw new ApiFault('storage_unavailable');
   const record=await owner.run(()=>options.outputs.published({id:params.exportId.toLowerCase(),scope:{kind:'workspace',
    organizationId:params.organizationId.toLowerCase(),workspaceId:params.workspaceId.toLowerCase()}}));
   const ifRange=header(request,'if-range');const range=selectRange(ifRange===undefined||ifRange===`"${record.artifact.sha256}"`?header(request,'range'):undefined,record.artifact.bytes);
   if(range===false)return reply.header('Content-Range',`bytes */${record.artifact.bytes}`).code(416).send(apiErrorResponse('invalid_value').body);
   return sendArtifact({reply,owner,record,kind:'standalone-k6-script',range,bytes});
  }});
 });
 return Object.freeze({close:()=>owners.close()});
}
