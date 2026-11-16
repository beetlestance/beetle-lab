import {captureStandaloneExportAssignment,encodeCanonicalJson} from '@beetle/contracts';
import {validateApi} from '@beetle/contracts/api';
import type {ExportKey,ExportOriginal} from '../../../../ports/exports.js';
import {captureFields} from '../../../../domain/events/index.js';
import {requireRule,sameScope,sameUuid} from '../../../../domain/namespaces/index.js';
import {boundedCopy,checkedJournalAuthority,sha256} from '../input-values.js';
/** Carrier/header and full original have separate roots and byte/node allowances. */
export function captureExportOriginal(input:unknown,expected:ExportKey):ExportOriginal {
 const value=captureFields(input,['key','assignment','journalAuthority','possibleDelivery','cancellationRequested','acknowledged']);
 const key=boundedCopy(value.key,1024) as ExportKey;
 requireRule(validateApi('WorkspaceScope',key.scope).ok&&validateApi('Uuid',key.id).ok);
 requireRule(Object.keys(key).sort().join(',')==='id,scope');
 requireRule(sameScope(key.scope,expected.scope)&&sameUuid(key.id,expected.id));
 if(value.journalAuthority!==null)checkedJournalAuthority(value.journalAuthority);
 requireRule([value.possibleDelivery,value.cancellationRequested,value.acknowledged].every(item=>typeof item==='boolean'));
 const assignment=captureStandaloneExportAssignment(value.assignment,sha256);
 requireRule(sameUuid(assignment.exportId,key.id)&&sameUuid(assignment.offer.organizationId,key.scope.organizationId)&&sameUuid(assignment.offer.workspaceId,key.scope.workspaceId));
 requireRule(value.possibleDelivery===false||value.journalAuthority!==null);requireRule(value.acknowledged===false||value.possibleDelivery===true);
 const header={key,journalAuthority:value.journalAuthority,possibleDelivery:value.possibleDelivery,cancellationRequested:value.cancellationRequested,acknowledged:value.acknowledged};
 encodeCanonicalJson(header,2048);
 return {...header,assignment} as ExportOriginal;
}
