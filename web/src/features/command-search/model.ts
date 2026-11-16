import {matchPath} from 'react-router-dom';
import {routes,validId} from '../../app/routes.js';
export interface SearchContext {readonly organizationId?:string;readonly workspaceId?:string}
export interface CommandItem {readonly id:string;readonly label:string;readonly description:string;readonly path:string}
export function searchContext(pathname:string):SearchContext{
 const workspace=matchPath({path:routes.workspacePattern+'/*',end:false},pathname);
 if(workspace){const {organizationId,workspaceId}=workspace.params;return validId(organizationId)&&validId(workspaceId)?{organizationId:organizationId.toLowerCase(),workspaceId:workspaceId.toLowerCase()}:{};}
 const org=matchPath({path:routes.organizationPattern+'/*',end:false},pathname)?.params.organizationId;
 return validId(org)?{organizationId:org.toLowerCase()}:{};
}
export function navigation(context:SearchContext):CommandItem[]{
 const item=(label:string,path:string):CommandItem=>({id:'nav:'+path,label,path,description:'Navigation'});
 const items=[item('Organizations',routes.organizations),item('Installation settings',routes.settings),item('API reference',routes.reference)];
 const org=context.organizationId;const workspace=context.workspaceId;
 if(org){items.push(item('Workspace index',routes.organization(org)),item('Organization settings',routes.organizationSettings(org)));}
 if(org&&workspace)items.push(item('Workspace folders',routes.workspace(org,workspace)),item('Inputs',routes.inputs(org,workspace)),item('Suites',routes.suites(org,workspace)),item('Runs',routes.runs(org,workspace)),item('Workspace settings',routes.workspaceSettings(org,workspace)));
 return items;
}
export function matching(items:readonly CommandItem[],query:string):{items:CommandItem[];total:number}{
 const text=query.slice(0,128).trim().toLowerCase();const found=items.filter(item=>`${item.label} ${item.description} ${item.path}`.toLowerCase().includes(text));
 return {items:found.slice(0,40),total:found.length};
}
