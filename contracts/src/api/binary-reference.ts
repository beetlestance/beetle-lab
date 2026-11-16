import {freezeSchema} from '../freeze.js';
import {INPUT_CHUNK_ROUTE,INPUT_CONTENT_ROUTE,INPUT_CHUNK_BYTES} from './input-content.js';
import {RUN_ARTIFACT_CONTENT_ROUTE} from './artifact-content.js';
import {EXPORT_CONTENT_ROUTE} from './export-content.js';
const template=(route:string)=>route.replace(/:([A-Za-z]+)/g,'{$1}');
/** Public HTTP documentation, separate from the generated JSON-only client. */
export const apiBinaryOperations=freezeSchema([
 {name:'appendInputChunk',method:'PUT',path:template(INPUT_CHUNK_ROUTE),params:'InputParams',
  query:{offset:'Required nonnegative integer byte offset from the staged InputRecord.'},
  requestHeaders:{'Content-Type':'application/octet-stream','Content-Encoding':'omit','Origin':'exact configured origin','X-Beetle-CSRF':'session CSRF value'},
  body:{minimumBytes:1,maximumBytes:INPUT_CHUNK_BYTES},successStatus:200,response:'InputRecord',
  notes:'Create input metadata first with full-file bytes/SHA256. Append while staging. Retain exact offset and bytes after lost acknowledgement; reread InputRecord before replay. Seal after all bytes are acknowledged.'},
 {name:'downloadInputContent',method:'GET',path:template(INPUT_CONTENT_ROUTE),params:'InputParams',query:{},requestHeaders:{},
  successStatus:200,response:'binary',mediaType:'application/octet-stream',
  integrity:{metadata:'InputRecord',bytes:'bytes',sha256:'sha256',etag:'quoted sha256'},
  notes:'Requires published input. For full verification omit Range, require status200 and hash/count the complete body. Transfer may be chunked; Content-Length is optional and, when present, equals declared bytes. Do not accept an error JSON/HTML body as file bytes.'},
 {name:'downloadRunArtifactContent',method:'GET',path:template(RUN_ARTIFACT_CONTENT_ROUTE),params:'RunArtifactParams',query:{},requestHeaders:{},
  successStatus:200,response:'binary',mediaType:'published artifact kind',
  integrity:{metadata:'RunArtifactPage.items[]',bytes:'bytes',sha256:'sha256',etag:'quoted sha256'},
  notes:'List scoped Run artifacts first. For full verification omit Range and require status200; stream at most declared bytes and verify full SHA256/EOF. Transfer may be chunked; Content-Length is not required.'},
 {name:'downloadExportContent',method:'GET',path:template(EXPORT_CONTENT_ROUTE),params:'ExportParams',query:{},requestHeaders:{},
  successStatus:200,response:'binary',mediaType:'standalone-k6-script',
  integrity:{metadata:'ExportJob.artifact',bytes:'bytes',sha256:'sha256',etag:'quoted sha256'},
  notes:'Requires ready export with artifact metadata. For full verification omit Range and require status200; stream at most declared bytes and verify full SHA256/EOF. No engine filename or private path is a selector.'},
] as const);
