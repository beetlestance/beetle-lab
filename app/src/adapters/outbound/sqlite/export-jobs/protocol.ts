import type {ExportOutputCommand,ExportOutputValue} from './output-protocol.js';
import type {ExportJob,ExportJobPage,ExportProfiles,WorkspaceScope} from '@beetle/contracts/api';
import type {CreateExportCommand,CancelExportCommand,ExportKey,ExportList,ExportControl,ExportOriginal,ExportExecutionStore,ExportScan,ExportCandidate} from '../../../../ports/exports.js';
export type ExportOperation={kind:'exportJob';command:CreateExportCommand|CancelExportCommand}
 | {kind:'getExport';key:ExportKey}|{kind:'listExports';query:ExportList}|{kind:'getExportProfiles';scope:WorkspaceScope}
 |{kind:'scanExportJobs';query:ExportScan}|{kind:'getExportOriginal';key:ExportKey}|{kind:'getExportControl';key:ExportKey}|{kind:'claimExport';key:ExportKey}
 |{kind:'observeExport';request:Parameters<ExportExecutionStore['observe']>[0]}
 |{kind:'finalizeExport';request:Parameters<ExportExecutionStore['finalize']>[0]}
 |{kind:'exportOutput';operation:ExportOutputCommand};
export type ExportValue=ExportOutputValue|ExportJob|ExportJobPage|ExportProfiles|ExportControl|ExportOriginal|readonly ExportCandidate[]|Awaited<ReturnType<ExportExecutionStore['claim']>>;
