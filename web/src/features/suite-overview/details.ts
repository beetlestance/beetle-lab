/**
 * Requests, thresholds and datasets of a saved k6 configuration, as the Suite
 * Overview shows them. Input files are referenced by id; names are read separately.
 */
type Json = Record<string, unknown>;
function record(value: unknown): value is Json {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function list(value: unknown, max = 64): unknown[] {
  return Array.isArray(value) && value.length <= max ? value : [];
}
const short = (value: unknown, max = 80) =>
  typeof value === 'string' ? (value.length > max ? `${value.slice(0, max - 1)}…` : value) : '';

export type Body = { kind: 'none' } | { kind: 'inline' } | { kind: 'input'; inputId: string };
export type RequestRow = {
  id: string;
  method: string;
  path: string;
  share: number | null;
  body: Body;
  checks: string[];
};

const name = (value: Json) => short(value.name, 32);
const path = (value: Json) => short(value.path, 48);
const quoted = (value: Json) => short(value.value, 32);
const literal = (value: Json) => short(JSON.stringify(value.value) ?? '', 32);
const checkText: Record<string, (value: Json) => string> = {
  statusEq: (value) => `status is ${String(value.value)}`,
  statusFamily: (value) => `status family is ${String(value.value)}xx`,
  bodyContains: (value) => `body contains "${quoted(value)}"`,
  headerExists: (value) => `header exists ${name(value)}`,
  headerEquals: (value) => `header ${name(value)} = "${quoted(value)}"`,
  headerContains: (value) => `header ${name(value)} contains "${quoted(value)}"`,
  jsonExists: (value) => `JSON path exists ${path(value)}`,
  jsonEquals: (value) => `JSON equals ${path(value)} = ${literal(value)}`,
  jsonContains: (value) => `JSON ${path(value)} contains ${literal(value)}`,
  jsonCompare: (value) => `JSON ${path(value)} ${short(value.operator, 2)} ${literal(value)}`,
};
function check(value: unknown): string | null {
  if (!record(value) || typeof value.kind !== 'string' || !Object.hasOwn(checkText, value.kind)) return null;
  return checkText[value.kind]!(value);
}
function body(value: unknown): Body {
  if (!record(value)) return { kind: 'none' };
  if (value.kind === 'input' && record(value.input) && typeof value.input.id === 'string')
    return { kind: 'input', inputId: value.input.id };
  return value.kind === 'json' ? { kind: 'inline' } : { kind: 'none' };
}
/** Share is each request's selection weight over all selection weights, in percent. */
export function requestRows(config: Json): RequestRow[] {
  const weights = new Map<string, number>();
  let total = 0;
  for (const selection of list(config.selections)) {
    if (!record(selection)) continue;
    for (const entry of list(selection.entries)) {
      if (!record(entry) || typeof entry.requestId !== 'string' || typeof entry.weight !== 'number') continue;
      weights.set(entry.requestId, (weights.get(entry.requestId) ?? 0) + entry.weight);
      total += entry.weight;
    }
  }
  return list(config.requests).flatMap((request) => {
    if (!record(request) || typeof request.id !== 'string') return [];
    const weight = weights.get(request.id);
    return [
      {
        id: request.id,
        method: short(request.method, 8),
        path: short(request.path, 120),
        share: total > 0 ? Math.round(((weight ?? 0) * 100) / total) : null,
        body: body(request.body),
        checks: list(request.assertions)
          .map(check)
          .filter((text): text is string => text !== null),
      },
    ];
  });
}

const statNames: Record<string, string> = { med: 'median', avg: 'average', min: 'minimum', max: 'maximum' };
const compare: Record<string, string> = { '<': 'under', '<=': 'at most', '>': 'above', '>=': 'at least' };
/** "p95 under 250 ms", "failed requests under 1%", "checks above 99%". */
function rateText(label: string, rule: Json, op: string, value: number): string | null {
  return rule.stat === 'rate' ? `${label} ${op} ${Math.round(value * 10_000) / 100}%` : null;
}
export function thresholdText(rule: unknown): string | null {
  if (!record(rule) || typeof rule.metric !== 'string' || typeof rule.value !== 'number') return null;
  const op = compare[String(rule.operator)];
  if (!op) return null;
  const stat = statNames[String(rule.stat)] ?? String(rule.stat);
  const amount = rule.value.toLocaleString('en-US');
  if (rule.metric === 'http_req_duration') return `${stat} ${op} ${amount} ms`;
  if (rule.metric === 'http_req_failed') return rateText('failed requests', rule, op, rule.value);
  if (rule.metric === 'checks') return rateText('checks', rule, op, rule.value);
  return `${rule.metric} ${stat} ${op} ${amount}`;
}
export function thresholds(config: Json): string[] {
  const plan = config.loadPlan;
  if (!record(plan)) return [];
  return list(plan.slos, 128)
    .map((rule) => {
      if (!record(rule)) return null;
      return (
        thresholdText(rule) ??
        `${short(rule.metric, 64)} ${short(rule.stat, 8)} ${short(rule.operator, 2)} ${String(rule.value)}`
      );
    })
    .filter((text): text is string => text !== null);
}

export type DatasetRow = {
  id: string;
  source: { kind: 'inline'; rows: number } | { kind: 'input'; inputId: string; format: string } | { kind: 'range' };
  selection: string;
};
export function datasets(config: Json): DatasetRow[] {
  return list(config.datasets).flatMap((value): DatasetRow[] => {
    if (!record(value) || typeof value.id !== 'string') return [];
    const selection = value.selection === 'byVu' ? 'one row per virtual user' : 'a random row each time';
    if ((value.kind === 'csv' || value.kind === 'json') && record(value.input) && typeof value.input.id === 'string')
      return [
        { id: value.id, source: { kind: 'input' as const, inputId: value.input.id, format: value.kind }, selection },
      ];
    if (value.kind === 'inline')
      return [{ id: value.id, source: { kind: 'inline' as const, rows: list(value.rows, 10_000).length }, selection }];
    return [{ id: value.id, source: { kind: 'range' as const }, selection }];
  });
}
/** Target origin only: a configured URL can carry paths or credentials that are not shown. */
export function targetOf(config: Json): string | null {
  if (typeof config.target !== 'string' || config.target.length > 2048) return null;
  try {
    const url = new URL(config.target);
    return ['http:', 'https:'].includes(url.protocol) && url.origin.length <= 512 ? url.origin : null;
  } catch {
    return null;
  }
}
