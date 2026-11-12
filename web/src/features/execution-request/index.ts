import type { Budget, CreateRunRequest, SuiteRevision, WorkspaceSettings } from '@beetle/contracts/api';

export const budgetFields = [
  ['cpuMillis', 'CPU (millicores)'], ['memoryBytes', 'Memory (bytes)'], ['pids', 'Process limit (count)'],
  ['timeoutMs', 'Timeout (milliseconds)'], ['outputBytes', 'Output (bytes)'],
] as const satisfies readonly (readonly [keyof Budget, string])[];
export interface RunValues {
  profile: string;
  budget: Record<keyof Budget, string>;
  mode: 'parallel' | 'isolated';
  preferIdle: boolean;
}
export function initialValues(settings: WorkspaceSettings): RunValues {
  const defaults = settings.effective.runDefaults;
  return { profile: defaults.engineProfile.value, mode: 'parallel', preferIdle: false,
    budget: { cpuMillis: String(defaults.budget.cpuMillis.value), memoryBytes: String(defaults.budget.memoryBytes.value),
      pids: String(defaults.budget.pids.value), timeoutMs: String(defaults.budget.timeoutMs.value), outputBytes: String(defaults.budget.outputBytes.value) } };
}
export function captureRequest(input: { revision: SuiteRevision; settings: WorkspaceSettings; values: RunValues; requestId: string }): CreateRunRequest {
  const { revision, settings, values, requestId } = input;
  if (!settings.effective.runDefaults.engineProfile.allowedValues.includes(values.profile)) throw new Error('Choose an allowed engine profile.');
  const budget: Budget = { cpuMillis: 0, memoryBytes: 0, pids: 0, timeoutMs: 0, outputBytes: 0 };
  for (const [key, label] of budgetFields) {
    const text = values.budget[key];
    const number = Number(text);
    const range = settings.effective.runDefaults.budget[key].allowedRange;
    if (!/^[1-9][0-9]*$/.test(text) || !Number.isSafeInteger(number) || number < range.minimum || number > range.maximum) {
      throw new Error(`Check ${label}: enter a whole number within the allowed range.`);
    }
    budget[key] = number;
  }
  return { scope: { ...revision.scope }, requestId, revisionId: revision.id, engineProfile: values.profile,
    budget, executionPolicy: { mode: values.mode, preferIdle: values.preferIdle } };
}
