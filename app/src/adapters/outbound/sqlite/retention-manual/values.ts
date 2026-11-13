import { encodeJson } from '@beetle/contracts';
import type { ManualRunDeletionCommand } from '../../../../ports/retention.js';
import { closed,natural,uuid,scope } from '../output-deletion/values.js';
import { timestamp } from '../../../../domain/retention/snapshot-fields.js';
import { digestMutationIntent } from '../../../../application/namespaces/index.js';
import { sha256 } from '../input-values.js';
export function captureManualCommand(input:unknown):ManualRunDeletionCommand&{readonly intentDigest:string}{
 const value:unknown=JSON.parse(encodeJson(input,4096));closed(value,['id','capturedAt','request']);
 const request=value.request;closed(request,['scope','runId','expectedRunVersion','requestId','settingsId','expectedVersion']);
 natural(request.expectedRunVersion,Number.MAX_SAFE_INTEGER,1);natural(request.expectedVersion,Number.MAX_SAFE_INTEGER,1);
 const owned={scope:scope(request.scope),runId:uuid(request.runId),expectedRunVersion:request.expectedRunVersion,
  requestId:uuid(request.requestId),settingsId:uuid(request.settingsId),expectedVersion:request.expectedVersion};
 return{id:uuid(value.id),capturedAt:timestamp(value.capturedAt),request:owned,intentDigest:digestMutationIntent({kind:'manualRunDeletionPreview',request:owned},sha256)};
}
