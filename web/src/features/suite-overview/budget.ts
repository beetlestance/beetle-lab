import type { Budget, WorkspaceSettings } from '@beetle/contracts/api';
import type { RunValues } from '../execution-request/index.js';

/** Budget fields in the units the Start run board shows; converted to API units on submit. */
const GIB = 1024 ** 3;
export type FriendlyKey = keyof Budget;
export const friendly: readonly { key: FriendlyKey; label: string; unit: string; scale: number }[] = [
  { key: 'cpuMillis', label: 'CPUs', unit: '', scale: 1000 },
  { key: 'memoryBytes', label: 'Memory', unit: 'GiB', scale: GIB },
  { key: 'pids', label: 'Processes', unit: '', scale: 1 },
  { key: 'outputBytes', label: 'Output', unit: 'GiB', scale: GIB },
  { key: 'timeoutMs', label: 'Time limit', unit: 'min', scale: 60_000 },
];
const trim = (value: number) => String(Math.round(value * 100) / 100);
export function toFriendly(key: FriendlyKey, value: number): string {
  return trim(value / friendly.find((field) => field.key === key)!.scale);
}
/** Friendly text to the API's whole-number string; leaves unparseable text for captureRequest to reject. */
export function fromFriendly(key: FriendlyKey, text: string): string {
  const number = Number(text.trim());
  if (text.trim() === '' || !Number.isFinite(number)) return text;
  return String(Math.round(number * friendly.find((field) => field.key === key)!.scale));
}
export function bytes(value: number): string {
  if (value >= GIB) return `${trim(value / GIB)} GiB`;
  if (value >= 1024 ** 2) return `${trim(value / 1024 ** 2)} MiB`;
  return value >= 1024 ? `${trim(value / 1024)} KiB` : `${value} bytes`;
}
export function budgetSentence(budget: Record<FriendlyKey, number>): string {
  const cpus = budget.cpuMillis / 1000;
  return [
    `${trim(cpus)} ${cpus === 1 ? 'CPU' : 'CPUs'}`,
    bytes(budget.memoryBytes),
    `${budget.pids.toLocaleString('en-US')} processes`,
    `${bytes(budget.outputBytes)} output`,
  ].join(', ');
}
export function sourceText(settings: WorkspaceSettings, workspaceName: string): string {
  const leaves = Object.values(settings.effective.runDefaults.budget);
  const kinds = new Set(leaves.map((leaf) => leaf.source.kind));
  if (kinds.size !== 1) return 'from workspace, organization and installation settings';
  const kind = [...kinds][0];
  return kind === 'workspace'
    ? `from ${workspaceName}`
    : kind === 'organization'
      ? 'from the organization'
      : 'from installation defaults';
}
export function defaultBudget(settings: WorkspaceSettings): Record<FriendlyKey, number> {
  const leaves = settings.effective.runDefaults.budget;
  return {
    cpuMillis: leaves.cpuMillis.value,
    memoryBytes: leaves.memoryBytes.value,
    pids: leaves.pids.value,
    timeoutMs: leaves.timeoutMs.value,
    outputBytes: leaves.outputBytes.value,
  };
}
/** "30-minute", "90-second", "2-hour". */
export function limitText(ms: number): string {
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000}-hour`;
  if (ms % 60_000 === 0) return `${ms / 60_000}-minute`;
  return `${Math.round(ms / 1000)}-second`;
}
export function friendlyValues(values: RunValues): Record<FriendlyKey, string> {
  const result = {} as Record<FriendlyKey, string>;
  for (const field of friendly) {
    const number = Number(values.budget[field.key]);
    result[field.key] = Number.isFinite(number) ? toFriendly(field.key, number) : values.budget[field.key];
  }
  return result;
}
