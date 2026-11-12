import type {Suite} from '@beetle/contracts/api';
import {ids,json,readNamespace} from '../../app/test-fixtures.js';
import type {RequestRecord} from '../../app/test-fixtures.js';
import {run} from '../runs/test-fixtures.js';
export {ids,json,readNamespace,testClient,mount,deferred,apiError,workspace} from '../../app/test-fixtures.js';
export const suiteId='11111111-1111-4111-8111-111111111111';
export function suite(organizationId=ids.a):Suite{
 return {id:suiteId,scope:{kind:'workspace',organizationId,workspaceId:ids.workspace},name:'Shared suite',version:1,folderId:ids.root,currentRevisionId:null};
}
export function read(request:RequestRecord):Response{
 const organizationId=request.path.includes(ids.b)?ids.b:ids.a;const scope={kind:'workspace' as const,organizationId,workspaceId:ids.workspace};
 if(request.path.includes('/suites?'))return json({scope,items:[suite(organizationId)],nextCursor:null});
 if(request.path.includes('/runs?'))return json({scope,items:[run(organizationId)],nextCursor:null});
 if(request.path.endsWith('/suites/'+suiteId))return json(suite(organizationId));
 if(request.path.includes('/revisions?'))return json({scope,suiteId,items:[],nextCursor:null});
 return readNamespace(request);
}
