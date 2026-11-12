import {EXPORT_CONTROL_BYTES,EXPORT_RESULT_BYTES,encodeJson} from '@beetle/contracts';
import {validateApi} from '@beetle/contracts/api';
import {digestMutationIntent} from '../namespaces/index.js';
import type {IntentDigest} from '../namespaces/index.js';
import {immutableSnapshot,requireRule,sameUuid} from '../../domain/namespaces/index.js';
import type {CreateExportOperation,CreateExportCommand,CancelExportOperation,CancelExportCommand} from '../../ports/exports.js';
export function prepareExportCommand(input:CreateExportOperation,digest:IntentDigest):CreateExportCommand {
 const copy=JSON.parse(encodeJson(input,65536)) as CreateExportOperation & {intentDigest?:string};
 requireRule(Object.keys(copy).every(key=>['kind','id','attemptId','requestedAt','request','intentDigest'].includes(key)));
 requireRule(copy.kind==='createExport'&&validateApi('CreateExportRequest',copy.request).ok);
 requireRule(copy.request.options.maximumBuildBytes+EXPORT_CONTROL_BYTES+EXPORT_RESULT_BYTES<=copy.request.budget.outputBytes);
 requireRule(validateApi('Uuid',copy.id).ok&&validateApi('Uuid',copy.attemptId).ok&&!sameUuid(copy.id,copy.attemptId));
 requireRule(validateApi('RunTimestamp',copy.requestedAt).ok);
 const intentDigest=digestMutationIntent({kind:copy.kind,request:copy.request},digest);
 requireRule(copy.intentDigest===undefined||copy.intentDigest===intentDigest);
 const {kind,id,attemptId,requestedAt,request}=copy;return immutableSnapshot({kind,id,attemptId,requestedAt,request,intentDigest});
}
export function prepareExportCancellation(input:CancelExportOperation,digest:IntentDigest):CancelExportCommand {
 const copy=JSON.parse(encodeJson(input,65536)) as CancelExportOperation & {intentDigest?:string};
 requireRule(Object.keys(copy).every(key=>['kind','id','request','intentDigest'].includes(key)));
 requireRule(copy.kind==='cancelExport'&&validateApi('Uuid',copy.id).ok&&validateApi('CancelExportRequest',copy.request).ok);
 const {kind,id,request}=copy;const intentDigest=digestMutationIntent({kind,id,request},digest);
 requireRule(copy.intentDigest===undefined||copy.intentDigest===intentDigest);
 return immutableSnapshot({kind,id,request,intentDigest});
}
