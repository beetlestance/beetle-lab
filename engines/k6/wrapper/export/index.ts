import { AttemptError } from '../failure/index.js';
import { ExportRunner } from './runner.js';
import type { StagedExportOptions, ExportReceipt } from './types.js';
export type { StagedExportOptions, ExportReceipt } from './types.js';
/** Fixed trusted packaging options only; no browser-selected local paths. */
export async function runStagedExport(options: StagedExportOptions): Promise<ExportReceipt> {
  try {return await new ExportRunner(Object.freeze({...options,installed:Object.freeze({...options.installed}),
    ...(options.exportAssignment ? {exportAssignment:Object.freeze({...options.exportAssignment})} : {})})).run();}
  catch(error) {const reason=error instanceof AttemptError ? error.reason : 'profile';
    return Object.freeze({ok:false,reason:reason==='cancelled'||reason==='deadline'||reason==='clock'?reason:'profile'});}
}
