import { fail } from './failure.js';
import { identifier, suiteLimits, unsafeNames } from './limits.js';
import { hasControl, safeRelativePath } from './target.js';
import type { DatasetPlan, DeepReadonly, SuiteConfig, TemplatePlan, TemplateToken } from './types.js';
export interface TemplateScope { datasets: readonly DatasetPlan[]; secrets: DeepReadonly<SuiteConfig['secrets']> }
function variable(text: string, scope: TemplateScope): TemplateToken {
  const parts = text.split('.');
  if (parts.some(part => !identifier.test(part) || unsafeNames.has(part))) fail('template');
  if (parts.length === 2 && parts[0] === 'secret') {
    if (!scope.secrets.some(secret => secret.name === parts[1])) fail('missing_dependency', '/secrets');
    return { kind: 'secret', name: parts[1]! };
  }
  if (parts.length === 3 && parts[0] === 'data') {
    const dataset = scope.datasets.find(dataset => dataset.id === parts[1]);
    if (!dataset?.columns.includes(parts[2]!)) fail('missing_dependency', '/datasets');
    return { kind: 'data', datasetId: parts[1]!, column: parts[2]! };
  }
  return fail('template');
}
function tokenize(value: string, scope: TemplateScope): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let offset = 0;
  while (offset < value.length) {
    if (tokens.length >= suiteLimits.templateTokens) fail('template');
    const start = value.indexOf('{{', offset);
    if (start < 0) { tokens.push({ kind: 'literal', value: value.slice(offset) }); break; }
    if (start > offset) tokens.push({ kind: 'literal', value: value.slice(offset, start) });
    const end = value.indexOf('}}', start + 2);
    if (end < 0) fail('template');
    tokens.push(variable(value.slice(start + 2, end), scope)); offset = end + 2;
  }
  if (tokens.length > suiteLimits.templateTokens || tokens.some(token => token.kind === 'literal' && /[{}]/.test(token.value))) fail('template');
  return tokens;
}
export function compileTemplate(value: string, context: TemplatePlan['context'], scope: TemplateScope): TemplatePlan {
  if (value.length > suiteLimits.templateChars) fail('template');
  const tokens = tokenize(value, scope);
  if (context === 'header' && hasControl(value)) fail('template');
  // A safe placeholder verifies the static path structure; substitutions require runtime revalidation.
  const literalPath = tokens.map(token => token.kind === 'literal' ? token.value : 'v').join('');
  if (context === 'path' && !safeRelativePath(literalPath)) fail('template');
  const safety = { path: 'relative-path', query: 'encode-query-component', header: 'no-crlf',
    json: 'json-string', text: 'text' } as const;
  return { tokens, context, safety: safety[context], maxRenderedChars: suiteLimits.renderedChars };
}
