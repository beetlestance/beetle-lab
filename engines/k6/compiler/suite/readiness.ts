import { compileAssertions } from './assertions.js';
import { fail } from './failure.js';
import { suiteLimits } from './limits.js';
import { compileTemplate } from './templates.js';
import type { TemplateScope } from './templates.js';
import type { ReadinessPlan, ValidatedSuiteConfig } from './types.js';
export function compileReadiness(config: ValidatedSuiteConfig, scope: TemplateScope): ReadinessPlan | undefined {
  const probe = config.readiness;
  if (!probe) return undefined;
  const upperBoundMs = probe.attempts * probe.timeoutMs + (probe.attempts - 1) * probe.intervalMs;
  if (upperBoundMs > probe.wallBudgetMs || upperBoundMs > suiteLimits.readinessMs) fail('readiness', '/readiness');
  const path = compileTemplate(probe.path, 'path', scope);
  if (path.tokens.some(token => token.kind === 'data')) fail('readiness', '/readiness');
  return { ...probe, method: 'GET', path, assertions: compileAssertions(probe.assertions), upperBoundMs,
    exhaustion: 'preparation-failed' };
}
