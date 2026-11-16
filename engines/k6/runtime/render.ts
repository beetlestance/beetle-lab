import type { BodyNode, DeepReadonly, RequestPlan, Row, TemplatePlan } from '../plan/index.js';
import { BoundedText, quoted, utf8Bytes } from './bounds.js';
import { stop } from './failure.js';
import type { HttpRequest } from './types.js';

export interface RenderScope { rows: ReadonlyMap<string, Row>; secret(name: string): string }
function controls(value: string, maximum = 31): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (code <= maximum || code === 127) return true;
  }
  return false;
}
function replacement(token: DeepReadonly<TemplatePlan['tokens'][number]>, scope: RenderScope): string {
  if (token.kind === 'literal') return token.value;
  if (token.kind === 'secret') return scope.secret(token.name);
  const row = scope.rows.get(token.datasetId);
  if (!row || !Object.hasOwn(row, token.column)) return stop('selection');
  return String(row[token.column]);
}
export function renderTemplate(plan: DeepReadonly<TemplatePlan>, scope: RenderScope): string {
  const output = new BoundedText(262_144, plan.maxRenderedChars);
  for (const token of plan.tokens) output.append(replacement(token, scope));
  const value = output.finish();
  if (plan.safety === 'no-crlf' && controls(value)) stop('header');
  return value;
}
function relativePath(value: string): void {
  if (!value.startsWith('/') || value.startsWith('//') || /[\\?#]/.test(value) || controls(value, 32)) stop('path');
  let decoded: string;
  try { decoded = decodeURIComponent(value); } catch { return stop('path'); }
  if (decoded.startsWith('//') || /[\\?#]/.test(decoded) || controls(decoded, 32)
    || decoded.split('/').some(segment => segment === '.' || segment === '..')) stop('path');
}
function encoded(output: BoundedText, value: string): void {
  for (const character of value) {
    try { output.append(encodeURIComponent(character)); } catch { return stop('path'); }
  }
}
function bodyNode(output: BoundedText, node: DeepReadonly<BodyNode>, scope: RenderScope): void {
  if (node.kind === 'template') { quoted(output, renderTemplate(node.template, scope)); return; }
  if (node.kind === 'scalar') {
    if (typeof node.value === 'string') quoted(output, node.value);
    else output.append(String(node.value));
    return;
  }
  if (node.kind === 'array') {
    output.append('[');
    node.items.forEach((item, index) => { if (index) output.append(','); bodyNode(output, item, scope); });
    output.append(']'); return;
  }
  output.append('{');
  node.entries.forEach((entry, index) => {
    if (index) output.append(',');
    quoted(output, entry.key); output.append(':'); bodyNode(output, entry.value, scope);
  });
  output.append('}');
}
function body(plan: DeepReadonly<RequestPlan>, scope: RenderScope): string | null {
  if (!plan.body) return null;
  const output = new BoundedText(plan.serialization.bodyBytes);
  if (plan.body.kind === 'input' && plan.body.format === 'text') {
    output.append('literal' in plan.body ? plan.body.literal : renderTemplate(plan.body.value, scope));
  }
  else bodyNode(output, plan.body.value, scope);
  return output.finish();
}
function headers(plan: DeepReadonly<RequestPlan>, scope: RenderScope): Record<string, string> {
  const result: Record<string, string> = Object.create(null) as Record<string, string>;
  let bytes = 0;
  const add = (name: string, value: string): void => {
    if (!/^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,128}$/.test(name) || controls(value)) stop('header');
    bytes += utf8Bytes(name) + utf8Bytes(value) + 4;
    if (bytes > plan.serialization.headerBytes) stop('request_limit');
    result[name] = value;
  };
  for (const header of plan.headers) add(header.name, renderTemplate(header.value, scope));
  if (plan.body && !(plan.body.kind === 'input' && plan.body.format === 'text')
    && !Object.keys(result).some(name => name.toLowerCase() === 'content-type')) add('Content-Type', 'application/json');
  return result;
}
export function retainBody(assertions: DeepReadonly<RequestPlan['assertions']>): boolean {
  return assertions.some(assertion => assertion.kind === 'bodyContains' || assertion.kind.startsWith('json'));
}
export function renderRequest(input: { target: string; plan: DeepReadonly<RequestPlan>; scope: RenderScope; timeoutMs: number; label: string }): HttpRequest {
  const { plan, scope } = input;
  const output = new BoundedText(plan.serialization.urlBytes);
  output.append(input.target);
  const path = renderTemplate(plan.path, scope); relativePath(path); output.append(path);
  plan.query.forEach((query, index) => {
    output.append(index ? '&' : '?'); encoded(output, query.name); output.append('=');
    encoded(output, renderTemplate(query.value, scope));
  });
  return { method: plan.method, url: output.finish(), headers: headers(plan, scope), body: body(plan, scope),
    timeoutMs: input.timeoutMs, label: input.label, responseType: retainBody(plan.assertions) ? 'text' : 'none' };
}
