import type {StandaloneExportAssignment,AttemptSnapshot} from '@beetle/contracts';
import type {CreateExportRequest,CancelExportRequest,ExportJob,ExportJobPage,ExportProfiles,WorkspaceScope} from '@beetle/contracts/api';
import type {RunProfilePin} from './runs.js';
import type {ExportOutputBinding} from '../domain/output-owner/index.js';
import type {OutputArtifactStore} from './output-artifacts.js';
import type {OutputFileRecord} from './output-bytes.js';

/** Explicit installed mapping: user resource profile to fixed offline engine. */
export interface ExportProfilePin {readonly sourceProfileId:string;readonly profile:RunProfilePin}
export interface ExportConfiguration {readonly profiles:readonly ExportProfilePin[];readonly pendingLimit:number}
export interface ExportKey {readonly scope:WorkspaceScope;readonly id:string}
export interface ExportList {readonly scope:WorkspaceScope;readonly limit:number;readonly cursor?:string}
export interface CreateExportOperation {
 readonly kind:'createExport';readonly id:string;readonly attemptId:string;readonly requestedAt:string;readonly request:CreateExportRequest;
}
export type CreateExportCommand=CreateExportOperation & {readonly intentDigest:string};
export interface CancelExportOperation {readonly kind:'cancelExport';readonly id:string;readonly request:CancelExportRequest}
export type CancelExportCommand=CancelExportOperation & {readonly intentDigest:string};
export interface ExportStore {
 create(command:CreateExportCommand):Promise<ExportJob>;
 cancel(command:CancelExportCommand):Promise<ExportJob>;
 get(key:ExportKey):Promise<ExportJob>;
 list(query:ExportList):Promise<ExportJobPage>;
 profiles(scope:WorkspaceScope):Promise<ExportProfiles>;
}
export interface ExportOriginal {
 readonly key:ExportKey;readonly assignment:StandaloneExportAssignment;
 readonly journalAuthority:string|null;readonly possibleDelivery:boolean;readonly acknowledged:boolean;readonly cancellationRequested:boolean;
}
export interface ExportControl {
 readonly key:ExportKey;readonly binding:ExportOutputBinding|null;readonly state:ExportJob['state'];
 readonly possibleDelivery:boolean;readonly acknowledged:boolean;readonly cancellationRequested:boolean;readonly cancellationDelivered:boolean;
}
export interface ExportScan {readonly limit:number;readonly after?:number}
export interface ExportCandidate {readonly order:number;readonly key:ExportKey}
/** Claim reserves shared credits and binds original physical authority before IO. */
export interface ExportExecutionStore {
 scan(query:ExportScan):Promise<readonly ExportCandidate[]>;
 original(key:ExportKey):Promise<ExportOriginal>;
 control(key:ExportKey):Promise<ExportControl>;
 claim(key:ExportKey):Promise<{readonly kind:'claimed'|'replay';readonly control:ExportControl}|{readonly kind:'blocked'}>;
 observe(request:{readonly key:ExportKey;readonly snapshot:AttemptSnapshot;readonly journalAuthority:string}):Promise<ExportJob>;
 finalize(request:{readonly binding:ExportOutputBinding;readonly manifestDigest:string;readonly sourceDigest:string}):Promise<ExportJob>;
}
export type ExportArtifacts=Pick<OutputArtifactStore<ExportOutputBinding>,
 'load'|'readSource'|'adopt'|'claimArtifact'|'recordProgress'|'beginPublication'|'recordPublication'> & {
 settleAbsence(request:{readonly binding:ExportOutputBinding;readonly proof:unknown}):Promise<ExportJob>;
 published(key:ExportKey):Promise<OutputFileRecord<ExportOutputBinding>>;
};
