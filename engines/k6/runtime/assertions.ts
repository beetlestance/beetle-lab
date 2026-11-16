import type { AssertionPlan, DeepReadonly } from '../plan/index.js';
import { utf8Bytes } from './bounds.js';
import { processableBody, responseJson } from './response-json.js';
import type { HttpResponse, RuntimeLimits } from './types.js';

export interface AssertionResult { passed: boolean; required: boolean }
function header(response: HttpResponse, name: string): string | undefined {
  let found: string | undefined;
  let count = 0;
  let bytes = 0;
  for (const key in response.headers) {
    if (!Object.hasOwn(response.headers, key)) continue;
    const value = response.headers[key]!;
    if (++count > 128 || key.length > 128 || value.length > 65_536) return undefined;
    try { bytes += utf8Bytes(key) + utf8Bytes(value, 65_536 - bytes); } catch { return undefined; }
    if (bytes > 65_536) return undefined;
    if (key.toLowerCase() === name.toLowerCase()) found = value;
  }
  return found;
}
function atPath(root: unknown, segments: readonly (string | number)[]): { found: boolean; value: unknown } {
  let value = root;
  for (const segment of segments) {
    if (segment === '__proto__' || segment === 'constructor' || segment === 'prototype') return { found: false, value: undefined };
    if (value === null || typeof value !== 'object' || !Object.hasOwn(value, segment)) return { found: false, value: undefined };
    value = (value as Record<string | number, unknown>)[segment];
  }
  return { found: true, value };
}
function compare(value: unknown, assertion: DeepReadonly<Extract<AssertionPlan, { kind: 'jsonCompare' }>>): boolean {
  if (typeof value !== 'number' || !Number.isFinite(value)) return false;
  switch (assertion.operator) {
    case 'lt': return value < assertion.value;
    case 'lte': return value <= assertion.value;
    case 'gt': return value > assertion.value;
    case 'gte': return value >= assertion.value;
  }
}
function jsonCheck(assertion: DeepReadonly<AssertionPlan>, parsed: ReturnType<typeof responseJson>): boolean {
  if (!('segments' in assertion) || !parsed.ok) return false;
  const found = atPath(parsed.value, assertion.segments);
  if (!found.found) return false;
  switch (assertion.kind) {
    case 'jsonExists': return true;
    case 'jsonEquals': return found.value === assertion.value;
    case 'jsonContains': return typeof found.value === 'string' && found.value.includes(assertion.value);
    case 'jsonCompare': return compare(found.value, assertion);
  }
}
function basicCheck(assertion: DeepReadonly<AssertionPlan>, response: HttpResponse, bodyAllowed: boolean): boolean | undefined {
  switch (assertion.kind) {
    case 'statusEq': return response.status === assertion.value;
    case 'statusFamily': return Math.floor(response.status / 100) === assertion.value;
    case 'bodyContains': return bodyAllowed ? response.body!.includes(assertion.value) : false;
    case 'headerExists': return header(response, assertion.name) !== undefined;
    case 'headerEquals': return header(response, assertion.name) === assertion.value;
    case 'headerContains': return header(response, assertion.name)?.includes(assertion.value) ?? false;
    default: return undefined;
  }
}
export function evaluateAssertions(assertions: DeepReadonly<AssertionPlan[]>, response: HttpResponse, limits: RuntimeLimits): AssertionResult[] {
  const parsed = assertions.some(assertion => 'segments' in assertion) ? responseJson(response.body, limits) : { ok: false as const };
  const bodyAllowed = processableBody(response.body, limits);
  return assertions.map(assertion => ({ required: assertion.required,
    passed: basicCheck(assertion, response, bodyAllowed) ?? jsonCheck(assertion, parsed) }));
}
