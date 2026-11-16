import {validateApi} from './validate.js';
import type {InputParams} from './generated/types.js';
const base='/api/v2/organizations/:organizationId/workspaces/:workspaceId/inputs/:inputId';
export const INPUT_CHUNK_ROUTE=base+'/chunks';
export const INPUT_CONTENT_ROUTE=base+'/content';
export const INPUT_CHUNK_BYTES=65536;
function selected(route:string,params:InputParams):string{
 if(!validateApi('InputParams',params).ok)throw Error('Invalid input selection');
 for(const key of ['organizationId','workspaceId','inputId'] as const)route=route.replace(`:${key}`,params[key]);
 return route;
}
export function inputContentPath(params:InputParams):string{return selected(INPUT_CONTENT_ROUTE,params);}
export function inputChunkPath(params:InputParams,offset:number):string{
 if(!Number.isSafeInteger(offset)||offset<0)throw Error('Invalid input offset');
 return selected(INPUT_CHUNK_ROUTE,params)+`?offset=${offset}`;
}
