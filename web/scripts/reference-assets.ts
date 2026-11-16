import {open} from 'node:fs/promises';
import {encodeJson} from '../../contracts/src/index.js';
import {apiSchemas,apiMessageSchemas,apiOperations,apiBinaryOperations} from '../../contracts/src/api/index.js';
import {k6ConfigReference} from '../../contracts/src/engine-config/k6.js';
import type {Plugin} from 'vite';
import {referenceDownloads as referencePaths} from '../src/app/reference-downloads.js';
interface Asset {readonly type:string;readonly body:string;readonly filename:string}
async function text(url:URL,maximum:number):Promise<string>{
 const handle=await open(url,'r');const bytes=Buffer.alloc(maximum+1);let offset=0;
 try{for(let n=0;n<32;n++){const read=await handle.read(bytes,offset,bytes.length-offset,offset);offset+=read.bytesRead;
  if(offset>maximum)throw Error('Reference source limit');if(read.bytesRead===0)return new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(0,offset));
 }throw Error('Reference read limit');}finally{await handle.close();}
}
/** Only shipped source data is published; no runtime configuration/environment is read. */
export async function referenceResources():Promise<ReadonlyMap<string,Asset>>{
 const [skill,markdown,license]=await Promise.all([
  text(new URL('../integrations/beetle-lab/SKILL.md',import.meta.url),16384),
  text(new URL(import.meta.resolve('@beetle/contracts/api/reference')),32768),text(new URL('../../LICENSE',import.meta.url),4096),
 ]);
 const notice='\n\n## License\n\n'+license;
 const catalogue=encodeJson({version:2,operations:apiOperations,binaryOperations:apiBinaryOperations,messages:apiMessageSchemas,schemas:apiSchemas,license:{name:'MIT',notice:license}},2097152);
 const transfers='\n\n## Binary transfers\n\nAll use the local session. Mutations also require exact Origin and CSRF headers.\n'
  +apiBinaryOperations.map(operation=>`\n### ${operation.name}\n\n\`\`\`json\n${encodeJson(operation,8192)}\n\`\`\`\n`).join('');
 const config=encodeJson({engineId:'k6',configVersion:1,...k6ConfigReference,license:{name:'MIT',notice:license}},262144);
 if(Buffer.byteLength(markdown+transfers+notice)>65536||Buffer.byteLength(skill+notice)>32768)throw Error('Reference output limit');
 return new Map([
  [referencePaths.skill,{type:'text/plain; charset=utf-8',body:skill+notice,filename:'SKILL.md'}],
  [referencePaths.markdown,{type:'text/plain; charset=utf-8',body:markdown+transfers+notice,filename:'public-api.md'}],
  [referencePaths.catalogue,{type:'application/json; charset=utf-8',body:catalogue,filename:'public-api.json'}],
  [referencePaths.k6,{type:'application/json; charset=utf-8',body:config,filename:'k6-config.json'}],
 ]);
}
/** Fixed public assets are identical in Vite development and source-built images. */
export function referenceAssets():Plugin{
 let pending:ReturnType<typeof referenceResources>|undefined;const resources=()=>pending??=referenceResources();
 return {name:'beetle-public-reference',
  async generateBundle(){for(const [path,asset] of await resources())this.emitFile({type:'asset',fileName:path.slice(1),source:asset.body});},
  async configureServer(server){const assets=await resources();server.middlewares.use((request,response,next)=>{
   const asset=assets.get((request.url??'').split('?',1)[0]!);if(!asset){next();return;}
   if(request.method!=='GET'&&request.method!=='HEAD'){response.statusCode=405;response.setHeader('Allow','GET, HEAD');response.end();return;}
   response.setHeader('Content-Type',asset.type);response.setHeader('X-Content-Type-Options','nosniff');response.setHeader('Cache-Control','no-store');
   response.setHeader('Content-Disposition',`attachment; filename="${asset.filename}"`);response.setHeader('Content-Length',Buffer.byteLength(asset.body));
   response.end(request.method==='HEAD'?undefined:asset.body);
  });},
 };
}
