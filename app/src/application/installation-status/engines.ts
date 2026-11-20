import type { EngineCatalogue, InstallationStatus } from '@beetle/contracts/api';
import { validateApi } from '@beetle/contracts/api';
import { requireRule } from '../../domain/namespaces/index.js';

/** Product catalogue: engines that plug into suites, runs and results, in display order. */
export const PLANNED_ENGINES = ['unit-tests', 'integration-tests', 'lint', 'formatting', 'mutation-testing'] as const;

function installedState(agent: InstallationStatus['agent']['state']): EngineCatalogue['engines'][number]['state'] {
  if (agent === 'ready' || agent === 'disabled' || agent === 'unknown') return agent;
  return 'unavailable';
}

/**
 * Installed k6 with the profiles the agent pins and their image facts, then the planned
 * engines. Built from an installation status already read; it adds no I/O of its own.
 */
export function engineCatalogue(status: InstallationStatus): EngineCatalogue {
  const value = {
    scope: { kind: 'installation' },
    generatedAt: status.generatedAt,
    engines: [
      { id: 'k6', availability: 'installed', state: installedState(status.agent.state), profiles: status.engines },
      ...PLANNED_ENGINES.map((id) => ({ id, availability: 'planned', state: 'planned', profiles: [] })),
    ],
  };
  const result = validateApi('EngineCatalogue', value);
  requireRule(result.ok);
  return result.value;
}
