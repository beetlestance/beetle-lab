import {validateApi} from './validate.js';
import type {ExportParams} from './generated/types.js';
export const EXPORT_CONTENT_ROUTE='/api/v2/organizations/:organizationId/workspaces/:workspaceId/exports/:exportId/content';
/** Same-origin immutable published script selection; no engine path input. */
export function exportContentPath(params:ExportParams):string {
 if(!validateApi('ExportParams',params).ok)throw new Error('Invalid export selection');
 let path:string=EXPORT_CONTENT_ROUTE;
 for(const key of ['organizationId','workspaceId','exportId'] as const)path=path.replace(`:${key}`,params[key].toLowerCase());
 return path;
}
