import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { ParentRetentionPreviewCommand } from '../../../../ports/retention.js';
import { closed,uuid } from '../output-deletion/values.js';
import { timestamp } from '../../../../domain/retention/snapshot-fields.js';
import { digestMutationIntent } from '../../../../application/namespaces/index.js';
import { sha256 } from '../input-values.js';
import { requireRule } from '../../../../domain/namespaces/index.js';
export function captureParentCommand(input:unknown):ParentRetentionPreviewCommand&{readonly intentDigest:string}{
 const value:unknown=JSON.parse(encodeJson(input,8192));closed(value,['id','capturedAt','request']);
 const checked=validateApi('RetentionPreviewRequest',value.request);requireRule(checked.ok);const request=checked.value;requireRule(request.scope.kind!=='workspace');
 const scope=request.scope.kind==='installation'?{kind:'installation' as const}:{kind:'organization' as const,organizationId:uuid(request.scope.organizationId)};
 const owned={scope,requestId:uuid(request.requestId),settingsId:uuid(request.settingsId),expectedVersion:request.expectedVersion,page:request.page};
 return{id:uuid(value.id),capturedAt:timestamp(value.capturedAt),request:owned,intentDigest:digestMutationIntent({kind:'parentRetentionPreview',request:owned},sha256)};
}
