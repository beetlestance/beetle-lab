import { validateK6DraftPart } from '@beetle/contracts/engine-config/k6';
import type { Config } from '../suites/draft.js';
import { identifierPattern, objects, text } from './model.js';
import type { Problem } from './model.js';
/** Secret declarations are references, not secret values. The agent validates actual bindings. */
export function secretProblems(config: Config): Problem[] {
  const problems: Problem[] = [];
  const names = new Set<string>();
  objects(config.secrets)
    .slice(0, 64)
    .forEach((secret, index) => {
      const name = text(secret.name);
      if (text(secret.locator) && identifierPattern.test(name) && !validateK6DraftPart('secret', secret))
        problems.push({
          path: `/secrets/${index}`,
          message: `Secret ${index + 1} needs a valid name, provider and binding reference.`,
        });
      if (!identifierPattern.test(name) || names.has(name))
        problems.push({
          path: `/secrets/${index}/name`,
          message: `Secret ${index + 1} needs a unique identifier using letters, digits, _ and -.`,
        });
      names.add(name);
      if (!/^[a-zA-Z0-9_][a-zA-Z0-9._-]{0,127}$/.test(text(secret.locator)))
        problems.push({
          path: `/secrets/${index}/locator`,
          message: `Secret ${index + 1} needs a binding reference configured on the agent (up to 128 letters, digits, ., _ or -).`,
        });
    });
  return problems;
}
