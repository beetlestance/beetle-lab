import type { ExportJob, SuiteRevision, SuiteRevisionSummary } from '@beetle/contracts/api';
import type { Diff } from './diff.js';
import type { ScriptRead } from './script-read.js';

export type Layout = 'split' | 'unified';
export type ScriptSide = { job: ExportJob | undefined; text: ScriptRead; pending: boolean; failed: boolean };
export type Comparison = {
  ordinal: number;
  other: SuiteRevision | undefined;
  choices: readonly SuiteRevisionSummary[];
  otherId: string;
  setOtherId: (id: string) => void;
  diff: Diff | null | undefined;
  changes: readonly string[];
  status: 'loading' | 'error' | 'only' | 'missing' | 'preparing' | 'too_large' | 'ready';
  refreshing: boolean;
  current: ScriptSide;
  compared: ScriptSide;
  retry: () => void;
};
