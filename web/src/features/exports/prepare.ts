import { validateApi } from '@beetle/contracts/api';
import type { CreateExportRequest, ExportJob, SuiteRevision, WorkspaceSettings } from '@beetle/contracts/api';
import { captureRequest, initialValues } from '../execution-request/index.js';

/** Options the export form uses by default; the result budget must cover them plus 72 KiB. */
export const defaultExportOptions = { maximumBuildBytes: 1048576 } as const;
const resultOverhead = 73728;

/** Secret names a revision references. Revisions with secrets are never exported. */
export function secretNames(revision: SuiteRevision): string[] {
  const secrets = (revision.config as { secrets?: unknown }).secrets;
  if (!Array.isArray(secrets)) return [];
  return secrets
    .map((secret) => (secret && typeof secret === 'object' ? (secret as { name?: unknown }).name : undefined))
    .filter((name): name is string => typeof name === 'string' && name !== '')
    .slice(0, 16);
}

/**
 * The export request built from workspace run defaults, the first installed export profile the
 * workspace allows, and the default options. Throws a readable message when defaults cannot fit.
 */
export function exportRequest(
  revision: SuiteRevision,
  settings: WorkspaceSettings,
  profiles: readonly string[],
  requestId: string,
): CreateExportRequest {
  const values = initialValues(settings);
  const allowed = settings.effective.runDefaults.engineProfile.allowedValues;
  const profile = profiles.includes(values.profile) ? values.profile : profiles.find((item) => allowed.includes(item));
  if (!profile) throw new Error('No export engine is installed for a profile this workspace allows.');
  const base = captureRequest({ revision, settings, values: { ...values, profile }, requestId });
  if (base.budget.outputBytes < defaultExportOptions.maximumBuildBytes + resultOverhead)
    throw new Error(
      'The workspace output budget is too small for a 1 MiB script. Raise it in workspace settings before preparing this script.',
    );
  const options = validateApi('StandaloneExportOptions', {
    ...defaultExportOptions,
    scriptTimeoutMs: base.budget.timeoutMs,
  });
  if (!options.ok)
    throw new Error(
      'The workspace run timeout exceeds the supported script limit. Choose a timeout of at most 48 hours in workspace settings.',
    );
  return { ...base, options: options.value };
}

export const exportTerminalStates: readonly ExportJob['state'][] = ['ready', 'failed', 'cancelled'];
export const exportSteps = [
  { states: ['queued'], label: 'Queued' },
  { states: ['dispatching'], label: 'Sent to the agent' },
  { states: ['generating'], label: 'Writing the script' },
  { states: ['publishing'], label: 'Checking and saving' },
] as const satisfies readonly { states: readonly ExportJob['state'][]; label: string }[];

/** Index of the step the job is on, or -1 when it is not preparing. */
export function stepIndex(state: ExportJob['state']): number {
  return exportSteps.findIndex((step) => (step.states as readonly string[]).includes(state));
}

const reasons: Partial<Record<NonNullable<ExportJob['reason']>, string>> = {
  unsupported_secrets: 'Suites that use secrets can’t be exported',
  invalid_config: 'The configuration could not be turned into a script',
  budget_unavailable: 'No capacity was free for the reserved budget',
  timeout: 'Writing the script took too long',
  output_limit: 'The script was larger than the output budget',
  build_failed: 'The script did not build',
  cancelled: 'Cancelled',
};
/** Short, honest text for a job's reason; falls back to the reason code itself. */
export function reasonText(reason: ExportJob['reason']): string {
  if (!reason) return '';
  return reasons[reason] ?? reason.replaceAll('_', ' ');
}

/** Bytes as "84 KB" or "1.2 MB" (decimal units, as the boards show). */
export function sizeText(bytes: number): string {
  if (bytes < 1000) return `${bytes} bytes`;
  if (bytes < 1e6) return `${Math.round(bytes / 1000)} KB`;
  return `${(bytes / 1e6).toFixed(bytes < 1e7 ? 1 : 0)} MB`;
}

/** Elapsed time since an ISO instant, as "12 s" or "3 min". Empty when the instant is unreadable. */
export function elapsedText(since: string, now: number): string {
  const start = Date.parse(since);
  if (!Number.isFinite(start)) return '';
  const seconds = Math.max(0, Math.round((now - start) / 1000));
  return seconds < 120 ? `${seconds} s` : `${Math.round(seconds / 60)} min`;
}

/** Exact declared milliseconds, rendered without rounding a small limit to zero. */
export function scriptLimitText(milliseconds: number): string {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1) return 'Not recorded';
  if (milliseconds % 60000 === 0) return `${milliseconds / 60000} min`;
  if (milliseconds % 1000 === 0) return `${milliseconds / 1000} s`;
  return `${milliseconds.toLocaleString('en-US')} ms`;
}
