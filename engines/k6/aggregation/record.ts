import { MetricStreamError } from './types.js';
import type { MetricDefinition, MetricKind, MetricPoint, MetricStreamOptions } from './types.js';
const kinds = new Set<MetricKind>(['counter', 'gauge', 'rate', 'trend']);
const fail = (code: ConstructorParameters<typeof MetricStreamError>[0]): never => { throw new MetricStreamError(code); };
function object(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return fail('invalid_record');
  return value as Record<string, unknown>;
}
function numeric(value: unknown, kind: MetricKind): number {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return fail('invalid_record');
  if (kind === 'counter' && !Number.isSafeInteger(value)) return fail('invalid_record');
  if (kind === 'rate' && value !== 0 && value !== 1) return fail('invalid_record');
  return value;
}
function timestamp(value: unknown): number {
  if (typeof value !== 'string' || value.length > 40
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return fail('invalid_record');
  const result = Date.parse(value);
  if (!Number.isSafeInteger(result) || result < 0) return fail('invalid_record');
  return result;
}
function envelope(line: Uint8Array): Record<string, unknown> {
  let raw: unknown;
  try { raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
  catch { return fail('invalid_record'); }
  const record = object(raw);
  if (Object.keys(record).some(key => !['type', 'metric', 'data'].includes(key))) fail('invalid_record');
  return record;
}
function labels(values: readonly string[], prefix: string): Set<string> {
  if (!Array.isArray(values) || values.length > 200) return fail('invalid_profile');
  if (values.some(value => typeof value !== 'string' || !new RegExp(`^${prefix}(0|[1-9][0-9]{0,2})$`).test(value))) return fail('invalid_profile');
  const result = new Set(values);
  if (result.size !== values.length) return fail('invalid_profile');
  return result;
}
/** Trusted owned-runtime profile is snapshotted; no sample can add a series. */
export class Records {
  private readonly metrics = new Map<string, MetricKind>();
  private readonly declared = new Set<string>();
  private readonly requests: Set<string>;
  private readonly assertions: Set<string>;
  constructor(options: MetricStreamOptions) {
    if (!Array.isArray(options.metrics) || options.metrics.length < 1 || options.metrics.length > 64) fail('invalid_profile');
    for (const definition of options.metrics) this.definition(definition);
    this.requests = labels(options.requestLabels, 'r'); this.assertions = labels(options.assertionLabels, 'a');
    if (1 + this.requests.size + this.assertions.size > 200) fail('invalid_profile');
  }
  private definition(definition: MetricDefinition): void {
    if (!definition || typeof definition.name !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(definition.name)
      || !kinds.has(definition.kind) || this.metrics.has(definition.name)) fail('invalid_profile');
    this.metrics.set(definition.name, definition.kind);
  }
  private tags(input: unknown): MetricPoint['tags'] {
    if (input === null) return Object.freeze({});
    const tags = object(input);
    const entries = Object.entries(tags);
    if (entries.length === 0) return Object.freeze({});
    if (entries.length !== 1) return fail('invalid_labels');
    const [key, value] = entries[0]!;
    if (typeof value !== 'string') return fail('invalid_labels');
    if (key === 'request' && this.requests.has(value)) return Object.freeze({ request: value });
    if (key === 'assertion' && this.assertions.has(value)) return Object.freeze({ assertion: value });
    return fail('invalid_labels');
  }
  read(line: Uint8Array): MetricPoint | undefined {
    const record = envelope(line);
    const name = record.metric;
    if (typeof name !== 'string' || !this.metrics.has(name)) return fail('unknown_metric');
    const kind = this.metrics.get(name)!;
    const data = object(record.data);
    if (record.type === 'Metric') {
      this.declare(name, kind, data); return undefined;
    }
    if (record.type !== 'Point' || !this.declared.has(name)) return fail('invalid_record');
    const value = numeric(data.value, kind);
    const timeMs = timestamp(data.time);
    return Object.freeze({ metric: name, kind, value, timeMs, tags: this.tags(data.tags) });
  }
  private declare(name: string, kind: MetricKind, data: Record<string, unknown>): void {
    if (data.type !== kind || (data.name !== undefined && data.name !== name) || this.declared.has(name)) fail('invalid_record');
    this.declared.add(name);
  }
}
