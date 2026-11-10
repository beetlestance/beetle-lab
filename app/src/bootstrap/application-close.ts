import type { Metadata } from '../adapters/outbound/sqlite/index.js';
import type { InputRuntime } from './input-runtime.js';

export function throwCloseFailures(results: readonly PromiseSettledResult<unknown>[]): void {
  const errors: unknown[] = []; const seen = new Set<object>();
  for (const result of results) {
    if (result.status !== 'rejected') continue;
    const error: unknown = result.reason;
    // The same owned failure can propagate directly and through the server hook.
    if (error !== null && typeof error === 'object') {
      if (seen.has(error)) continue;
      seen.add(error);
    }
    errors.push(error);
  }
  if (errors.length === 1) throw errors[0];
  if (errors.length > 1) throw new AggregateError(errors, 'Application shutdown failed');
}
/** Metadata remains available to every original publisher and input operation. */
export async function closeApplicationStore(agent: { close(): Promise<void> } | undefined, inputs: Pick<InputRuntime, 'close'> | undefined,
  metadata: Pick<Metadata, 'close'>): Promise<void> {
  const owned = await Promise.allSettled([Promise.resolve().then(() => agent?.close()), Promise.resolve().then(() => inputs?.close())]);
  const store = await Promise.allSettled([Promise.resolve().then(() => metadata.close())]);
  throwCloseFailures([...owned, ...store]);
}
