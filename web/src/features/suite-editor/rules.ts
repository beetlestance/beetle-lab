import { text } from './model.js';
import type { Obj } from './model.js';

type CheckKind = {
  kind: string;
  label: string;
  name?: true;
  path?: true;
  operator?: true;
  value?: 'status' | 'family' | 'text' | 'scalar' | 'number' | 'optional-text';
};
export const checkKinds: readonly CheckKind[] = [
  { kind: 'statusEq', label: 'Status is', value: 'status' },
  { kind: 'statusFamily', label: 'Status family is', value: 'family' },
  { kind: 'bodyContains', label: 'Body contains', value: 'text' },
  { kind: 'headerExists', label: 'Header exists', name: true },
  { kind: 'headerEquals', label: 'Header equals', name: true, value: 'optional-text' },
  { kind: 'headerContains', label: 'Header contains', name: true, value: 'text' },
  { kind: 'jsonExists', label: 'JSON path exists', path: true },
  { kind: 'jsonEquals', label: 'JSON value equals', path: true, value: 'scalar' },
  { kind: 'jsonContains', label: 'JSON contains', path: true, value: 'text' },
  { kind: 'jsonCompare', label: 'JSON compares', path: true, operator: true, value: 'number' },
];
export const checkKind = (kind: unknown) => checkKinds.find((item) => item.kind === kind);
export const compareOperators = { lt: '<', lte: '≤', gt: '>', gte: '≥' } as const;

const operatorText = (check: Obj) => compareOperators[check.operator as keyof typeof compareOperators] ?? '?';
const labels: Record<string, (check: Obj, shown: string) => string> = {
  statusEq: (check) => `status is ${String(check.value)}`,
  statusFamily: (check) => `status family is ${String(check.value)}xx`,
  bodyContains: (_, shown) => `body contains ${shown}`,
  headerExists: (check) => `header exists ${text(check.name)}`,
  headerEquals: (check, shown) => `header ${text(check.name)} = ${shown}`,
  headerContains: (check, shown) => `header ${text(check.name)} contains ${shown}`,
  jsonExists: (check) => `JSON path exists ${text(check.path)}`,
  jsonEquals: (check, shown) => `JSON equals ${text(check.path)} = ${shown}`,
  jsonContains: (check, shown) => `JSON ${text(check.path)} contains ${shown}`,
  jsonCompare: (check) => `JSON ${text(check.path)} ${operatorText(check)} ${String(check.value)}`,
};
/** Short chip text for one assertion, e.g. "status is 201" or "JSON path exists $.cartId". */
export function checkLabel(check: Obj): string {
  const value = check.value;
  const shown = typeof value === 'string' ? `"${value}"` : JSON.stringify(value);
  const label = typeof check.kind === 'string' && Object.hasOwn(labels, check.kind) ? labels[check.kind] : undefined;
  return label ? label(check, shown) : `check ${text(check.id, '?')}`;
}
const blanks: Record<string, Obj> = {
  statusEq: { value: 200 },
  statusFamily: { value: 2 },
  headerExists: { name: 'etag' },
  headerEquals: { name: 'content-type', value: 'application/json' },
  headerContains: { name: 'content-type', value: 'application/json' },
  jsonExists: { path: '$.id' },
  jsonEquals: { path: '$.status', value: 'ok' },
  jsonContains: { path: '$.status', value: 'ok' },
  jsonCompare: { path: '$.count', operator: 'gte', value: 0 },
};
/** A new assertion of `kind`, keeping id and required flag. */
export function blankCheck(kind: string, id: string, required = true): Obj {
  return { id, required, kind, ...(Object.hasOwn(blanks, kind) ? blanks[kind] : { value: 'ok' }) };
}

export const thresholdPresets = [
  { id: 'p95', label: 'p95', metric: 'http_req_duration', stat: 'p95', percent: false },
  { id: 'p99', label: 'p99', metric: 'http_req_duration', stat: 'p99', percent: false },
  { id: 'p90', label: 'p90', metric: 'http_req_duration', stat: 'p90', percent: false },
  { id: 'med', label: 'median', metric: 'http_req_duration', stat: 'med', percent: false },
  { id: 'avg', label: 'average', metric: 'http_req_duration', stat: 'avg', percent: false },
  { id: 'failed', label: 'failed requests %', metric: 'http_req_failed', stat: 'rate', percent: true },
  { id: 'checks', label: 'checks passing %', metric: 'checks', stat: 'rate', percent: true },
] as const;
export const thresholdOperators = [
  { id: '<', label: 'under' },
  { id: '<=', label: 'at most' },
  { id: '>', label: 'above' },
  { id: '>=', label: 'at least' },
] as const;
export function presetOf(rule: Obj) {
  return thresholdPresets.find((preset) => preset.metric === rule.metric && preset.stat === rule.stat);
}
/** Percent presets store a 0–1 rate; the form shows and accepts percent. */
export function shownValue(rule: Obj): string {
  const preset = presetOf(rule);
  if (typeof rule.value !== 'number') return typeof rule.value === 'string' ? rule.value : '';
  return preset?.percent ? String(Math.round(rule.value * 1e6) / 1e4) : String(rule.value);
}
export function storedValue(rule: Obj, input: string): number | string {
  if (!/^(0|[1-9][0-9]{0,12})(\.[0-9]{1,6})?$/.test(input)) return input;
  return presetOf(rule)?.percent ? Math.round(Number(input) * 1e4) / 1e6 : Number(input);
}
