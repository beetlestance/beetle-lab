import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { Run, RunPage } from '@beetle/contracts/api';
import { immutableSnapshot } from '../../domain/namespaces/index.js';

export function runSnapshot<T>(value: T, maximum = 65536): T {
  return immutableSnapshot(JSON.parse(encodeJson(value, maximum)) as T);
}

function consistentRun(run: Run): boolean {
  if (run.state === 'finished') return ['passed', 'failed', 'inconclusive'].includes(run.outcome)
    && run.validationStatus === 'passed' && run.reason === null;
  if (run.state === 'cancelled') return run.outcome === 'inconclusive'
    && run.cancellationRequested && run.reason === 'cancelled';
  if (run.state === 'errored') return run.outcome === 'inconclusive' && run.reason !== null;
  return run.outcome === 'pending';
}

/** Validate after bounded copying; never retain repository-owned mutable data. */
export function checkedRun(input: unknown): Run {
  const result = validateApi('Run', runSnapshot(input));
  if (!result.ok || !consistentRun(result.value)) throw new Error('Invalid run repository response');
  return result.value;
}

export function checkedRunPage(input: unknown): RunPage {
  const result = validateApi('RunPage', runSnapshot(input, 1048576));
  if (!result.ok) throw new Error('Invalid run repository page');
  for (const item of result.value.items) checkedRun(item);
  return result.value;
}
