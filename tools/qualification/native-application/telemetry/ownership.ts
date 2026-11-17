import assert from 'node:assert/strict';
export type Closer = () => unknown | Promise<unknown>;
const uncertain = new Set<object>();
/** One failed benchmark process keeps all uncertain owners until kernel containment. */
export function retain(owner: object) {
  assert(uncertain.size < 8 || uncertain.has(owner));
  uncertain.add(owner);
}
export function hasUncertainOwners() {
  return uncertain.size !== 0;
}
export async function closeOrdered(closers: readonly Closer[]) {
  for (const close of closers) await close();
}
export async function closeGroup(closers: readonly Closer[]) {
  const results = await Promise.allSettled(closers.map((close) => Promise.resolve().then(close)));
  const failures = results.filter((result) => result.status === 'rejected').map((result) => result.reason as unknown);
  if (failures.length) throw new AggregateError(failures, 'Telemetry sibling owners failed to drain');
}
