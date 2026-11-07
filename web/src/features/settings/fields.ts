import type { Budget, RetentionPolicy } from '@beetle/contracts/api';
import type { EditorField } from '../../components/Editor.js';

export const budgetLabels = {
  cpuMillis: 'CPU (millicores)', memoryBytes: 'Memory (bytes)', pids: 'Process limit (count)',
  timeoutMs: 'Timeout (milliseconds)', outputBytes: 'Output (bytes)',
} satisfies Record<keyof Budget, string>;
export const poolLabels = { ...budgetLabels, concurrency: 'Concurrency (count)', storageBytes: 'Storage (bytes)',
  freeSpaceReserveBytes: 'Free space reserve (bytes)' };
export function integer(value: string, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): number {
  if (!/^(0|[1-9][0-9]*)$/.test(value)) throw new Error('Enter a canonical whole number.');
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error('Value is outside the allowed range.');
  return parsed;
}
export function numericField(name: string, label: string, value: number | undefined, minimum = 1, maximum = Number.MAX_SAFE_INTEGER): EditorField {
  return { name, label, value: value === undefined ? '' : String(value), pattern: '(0|[1-9][0-9]*)',
    help: `Whole number: ${minimum}–${maximum}.` };
}
export function retentionFields(policy: RetentionPolicy | undefined): EditorField[] {
  const rules = policy?.mode === 'enabled' ? policy : undefined;
  return [{ name: 'mode', label: 'Retention mode', value: policy?.mode ?? 'manual', options: ['manual', 'enabled'] },
    ...(['ageDays', 'completedRunCount', 'storageBytes'] as const).map(name => ({
      ...numericField(name, { ageDays: 'Maximum age (days)', completedRunCount: 'Completed run limit (count)', storageBytes: 'Retention storage (bytes)' }[name],
        rules?.[name], 1, name === 'ageDays' ? 365000 : Number.MAX_SAFE_INTEGER), required: false,
    }))];
}
export function parseRetention(values: Readonly<Record<string, string>>): RetentionPolicy {
  if (values.mode === 'manual') return { mode: 'manual' };
  const rules: { ageDays?: number; completedRunCount?: number; storageBytes?: number } = {};
  for (const key of ['ageDays', 'completedRunCount', 'storageBytes'] as const) {
    if (values[key]) rules[key] = integer(values[key], 1, key === 'ageDays' ? 365000 : Number.MAX_SAFE_INTEGER);
  }
  if (values.mode !== 'enabled' || Object.keys(rules).length === 0) throw new Error('Enabled retention requires at least one rule.');
  return { mode: 'enabled', ...rules };
}
export function retentionText(policy: RetentionPolicy): string {
  if (policy.mode === 'manual') return 'Manual deletion';
  return Object.entries(policy).filter(([key]) => key !== 'mode').map(([key, value]) => `${key}: ${value}`).join('; ');
}
