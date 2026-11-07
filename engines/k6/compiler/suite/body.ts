import { fail } from './failure.js';
import { parseInputJson, safeObject, scalar } from './json.js';
import { suiteLimits, unsafeNames } from './limits.js';
import { reserveBodyNode, reserveExpansion } from './resources.js';
import type { ExpansionBudget } from './resources.js';
import { compileTemplate } from './templates.js';
import type { TemplateScope } from './templates.js';
import type { BodyNode, BodyPlan, DeepReadonly, RequestConfig } from './types.js';
interface BodyState { budget: ExpansionBudget; scope: TemplateScope }
function bodyNode(value: unknown, state: BodyState, depth: number): BodyNode {
  reserveBodyNode(state.budget);
  if (depth > suiteLimits.jsonDepth) fail('input_limit');
  if (typeof value === 'string') return { kind: 'template', template: compileTemplate(value, 'json', state.scope) };
  if (scalar(value)) return { kind: 'scalar', value };
  if (Array.isArray(value)) {
    if (value.length > 4096) fail('input_limit');
    return { kind: 'array', items: value.map(child => bodyNode(child, state, depth + 1)) };
  }
  if (!safeObject(value) || Object.keys(value).length > 4096) fail('invalid_json');
  const entries = Object.keys(value).sort().map(key => {
    if (unsafeNames.has(key) || key.length > suiteLimits.cellChars || /[{}]/.test(key)) fail('template');
    return { key, value: bodyNode(value[key], state, depth + 1) };
  });
  return { kind: 'object', entries };
}
export function compileBody(body: DeepReadonly<RequestConfig['body']>, inputs: ReadonlyMap<string, string>, scope: TemplateScope, budget: ExpansionBudget): BodyPlan | undefined {
  if (!body) return undefined;
  if (body.kind === 'json') return { kind: 'json', value: bodyNode(body.value, { budget, scope }, 0) };
  reserveExpansion(budget, body.input.bytes);
  const text = inputs.get(body.input.id)!;
  if (body.format === 'text') return { kind: 'input', format: 'text', input: { ...body.input }, value: compileTemplate(text, 'text', scope) };
  return { kind: 'input', format: 'json', input: { ...body.input }, value: bodyNode(parseInputJson(text), { budget, scope }, 0) };
}
