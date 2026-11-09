import { encodeJson, validatePrimitive } from '@beetle/contracts';
import { DISPATCH_CURSOR_BYTES, DISPATCH_PAGE_BYTES, DISPATCH_SCAN_LIMIT } from '../../../../ports/dispatch.js';
import type { DispatchCandidate, DispatchKey, DispatchPage, DispatchScan } from '../../../../ports/dispatch.js';

type Lane = DispatchScan['lane'];
const reasons = ['capacity_unknown', 'profile_unavailable', 'per_run_ceiling', 'budget_unavailable',
  'staging_unavailable', 'storage_unavailable', 'isolated', 'isolated_predecessor',
  'not_queued', 'untracked_intent', 'ownership_unknown'];
function requireValue(valid: boolean): asserts valid {
  if (!valid) throw new Error('Invalid delivery discovery');
}
function closed(value: object, fields: readonly string[]): void {
  requireValue(Object.keys(value).length === fields.length && fields.every(field => Object.hasOwn(value, field)));
}
function cursor(value: unknown): asserts value is string {
  requireValue(typeof value === 'string' && value.length > 0 && Buffer.byteLength(value) <= DISPATCH_CURSOR_BYTES);
}
function key(value: DispatchKey): void {
  requireValue(value !== null && typeof value === 'object');
  closed(value, ['runId', 'attempt']);
  const attempt = value.attempt;
  requireValue(attempt !== null && typeof attempt === 'object');
  closed(attempt, ['organizationId', 'workspaceId', 'attemptId', 'generation', 'intentDigest']);
  requireValue([value.runId, attempt.organizationId, attempt.workspaceId, attempt.attemptId]
    .every(id => validatePrimitive('uuid', id).ok));
  requireValue(attempt.generation === 1 && typeof attempt.intentDigest === 'string' && /^[a-f0-9]{64}$/.test(attempt.intentDigest));
}
function candidate(value: DispatchCandidate): void {
  requireValue(value !== null && typeof value === 'object');
  closed(value, ['key', 'order', 'after', 'eligibility']);
  key(value.key); cursor(value.after);
  requireValue(Number.isSafeInteger(value.order) && value.order >= 0);
  const eligibility = value.eligibility;
  requireValue(eligibility !== null && typeof eligibility === 'object');
  closed(eligibility, eligibility.kind === 'blocked' ? ['kind', 'reason'] : ['kind']);
  requireValue(eligibility.kind === 'ready' || eligibility.kind === 'blocked' && reasons.includes(eligibility.reason));
}
function page(input: DispatchPage): DispatchPage {
  // Copy only bounded compact discovery facts; never retain a worker-owned page.
  const value = JSON.parse(encodeJson(input, DISPATCH_PAGE_BYTES)) as DispatchPage;
  requireValue(value !== null && typeof value === 'object');
  closed(value, ['items', 'nextCursor']);
  requireValue(Array.isArray(value.items) && value.items.length <= DISPATCH_SCAN_LIMIT);
  for (const item of value.items) candidate(item);
  if (value.nextCursor !== null) {
    cursor(value.nextCursor);
    requireValue(value.items.length > 0 && value.nextCursor === value.items.at(-1)?.after);
  }
  return value;
}

/** Two compact continuations, one page and at most one selected item per turn. */
export function discovery(scan: (query: DispatchScan) => Promise<DispatchPage>) {
  const cursors: Record<Lane, string | undefined> = { queued: undefined, reconcile: undefined };
  let lane: Lane = 'queued';
  return async (): Promise<DispatchCandidate | undefined> => {
    const selectedLane = lane;
    lane = lane === 'queued' ? 'reconcile' : 'queued';
    const after = cursors[selectedLane];
    const value = page(await scan({ lane: selectedLane, limit: DISPATCH_SCAN_LIMIT,
      ...(after === undefined ? {} : { cursor: after }) }));
    const selected = value.items.find(item => item.eligibility.kind === 'ready');
    // A selected final-page item can still have unread successors. Its after
    // cursor also carries the captured upper order through removals/new arrivals.
    cursors[selectedLane] = selected?.after ?? value.nextCursor ?? undefined;
    return selected;
  };
}
