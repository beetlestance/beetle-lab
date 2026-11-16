import { compileAssertions } from './assertions.js';
import { compileBody } from './body.js';
import { fail } from './failure.js';
import { hasControl, safeHeaderName } from './target.js';
import type { ExpansionBudget } from './resources.js';
import { compileTemplate } from './templates.js';
import type { TemplateScope } from './templates.js';
import type { RequestPlan, ValidatedSuiteConfig } from './types.js';
export function compileRequests(config: ValidatedSuiteConfig, inputs: ReadonlyMap<string, string>, scope: TemplateScope, budget: ExpansionBudget): RequestPlan[] {
  return config.requests.map(request => {
    const names = new Set<string>();
    const headers = Object.entries(request.headers).map(([name, value]) => {
      const normalized = name.toLowerCase();
      if (!safeHeaderName(name) || names.has(normalized)) fail('template', '/requests');
      names.add(normalized);
      return { name: normalized, value: compileTemplate(value, 'header', scope) };
    }).sort((a, b) => a.name < b.name ? -1 : 1);
    const query = Object.keys(request.query).sort().map(name => {
      if ((hasControl(name) || /[{}]/.test(name))) fail('template', '/requests');
      return { name, value: compileTemplate(request.query[name]!, 'query', scope) };
    });
    const result: RequestPlan = { serialization: { urlBytes: 65_536, headerBytes: 65_536, bodyBytes: 8_388_608 }, id: request.id, name: request.name, method: request.method,
      path: compileTemplate(request.path, 'path', scope), query, headers,
      assertions: compileAssertions(request.assertions), assertionFailureClass: 'assertion', transportFailureClass: 'transport' };
    const body = compileBody(request.body, inputs, scope, budget);
    if (body) result.body = body;
    return result;
  });
}
