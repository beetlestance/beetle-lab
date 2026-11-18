import { validateK6DraftPart } from '@beetle/contracts/engine-config/k6';
import type { Config } from '../suites/draft.js';
import { objects, text } from './model.js';
import type { Problem } from './model.js';
/** Structural draft checks reuse the exact engine schemas; admitted engine work still owns parsing and expansion. */
export function datasetProblems(config: Config): Problem[] {
  const problems: Problem[] = [];
  const names = new Set<string>();
  objects(config.datasets)
    .slice(0, 64)
    .forEach((dataset, index) => {
      const name = text(dataset.id);
      if (names.has(name))
        problems.push({ path: `/datasets/${index}/id`, message: `Dataset ${index + 1} needs a unique name.` });
      names.add(name);
      if (!validateK6DraftPart('dataset', dataset))
        problems.push({
          path: `/datasets/${index}`,
          message: `Dataset ${index + 1} needs valid rows, a number range or a published input reference.`,
        });
    });
  return problems;
}
