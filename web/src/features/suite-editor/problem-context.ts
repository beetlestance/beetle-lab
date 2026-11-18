import type { Config } from '../suites/draft.js';
import { isObj, objects, text } from './model.js';

/** Navigation labels come from the current draft, never from guessed request or input names. */
export function problemContext(path: string, config: Config | null): string {
  const parts = path.split('/').slice(1);
  if (!config) return 'Configuration';
  if (parts[0] === 'requests') {
    const request = objects(config.requests)[Number(parts[1])];
    return request ? `Requests › ${text(request.method)} ${text(request.path)}` : 'Requests';
  }
  if (parts[0] === 'datasets') {
    const item = objects(config.datasets)[Number(parts[1])];
    return item ? `Datasets › ${text(item.id, 'Unnamed dataset')}` : 'Datasets';
  }
  if (parts[0] === 'loadPlan' && parts[1] === 'slos') {
    return thresholdContext(config, Number(parts[2]));
  }
  const groups: Record<string, string> = {
    metadata: 'About',
    target: 'About › Target',
    secrets: 'Run setup › Secrets',
    selections: 'Run setup › Request mix',
    loadPlan: 'How load arrives',
    readiness: 'Run setup › Readiness probe',
    targetSampling: 'Run setup › Target sampling',
    message: 'Revision message',
  };
  return groups[parts[0] ?? ''] ?? 'Configuration';
}

function thresholdContext(config: Config, index: number) {
  const item = objects(isObj(config.loadPlan) ? config.loadPlan.slos : undefined)[index];
  return item ? `Pass only if › ${text(item.stat, text(item.metric, 'Threshold'))}` : 'Pass only if';
}
