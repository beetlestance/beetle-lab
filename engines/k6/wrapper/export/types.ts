import type { StandaloneExportResult } from '@beetle/contracts';
import type { OpenStagedOptions } from '../input/index.js';
import type { EventNotification } from '../lifecycle/index.js';
export interface StagedExportOptions extends OpenStagedOptions {
  readonly outputRoot:string;
  readonly onEvent?: EventNotification;
}
export type ExportReceipt = {readonly ok:true;readonly result: StandaloneExportResult}
  | {readonly ok:false;readonly reason:'profile'|'input'|'generation'|'publication'|'cleanup'|'cancelled'|'deadline'|'clock'};
