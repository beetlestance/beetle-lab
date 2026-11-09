import type { Metadata } from '../adapters/outbound/sqlite/index.js';
import type { AgentRuntime } from './agent-runtime.js';
import type { InputRuntime } from './input-runtime.js';

export function throwCloseFailures(results: readonly PromiseSettledResult<unknown>[]): void {
  const errors = results.flatMap(result => result.status === 'rejected' ? [result.reason as unknown] : []);
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Application shutdown failed');
}
/** Metadata remains available to every original publisher and input operation. */
export async function closeApplicationStore(agent: Pick<AgentRuntime, 'close'> | undefined, inputs: Pick<InputRuntime, 'close'> | undefined,
  metadata: Pick<Metadata, 'close'>): Promise<void> {
  const owned = await Promise.allSettled([Promise.resolve().then(() => agent?.close()), Promise.resolve().then(() => inputs?.close())]);
  const store = await Promise.allSettled([Promise.resolve().then(() => metadata.close())]);
  throwCloseFailures([...owned, ...store]);
}
