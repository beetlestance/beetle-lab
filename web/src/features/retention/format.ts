import type {
  ProtectedExclusion,
  RetentionBatchSummary,
  RetentionCandidate,
  RetentionPolicy,
  RetentionStatusItem,
} from '@beetle/contracts/api';
import type { StatusTone } from '../../components/Badge.js';
import { formatBytes, formatTime, shortId } from '../run-results/format.js';

export { formatTime, shortId };

/** Byte figure in display units; null stays "unknown", never zero. */
export function bytes(value: number | null): string {
  return formatBytes(value) ?? 'unknown';
}

const clockFormat = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
/** "05:20"; the full timestamp goes in a title attribute where it matters. */
export function clock(iso: string): string {
  const value = Date.parse(iso);
  return Number.isFinite(value) ? clockFormat.format(value) : iso;
}

export function runs(count: number): string {
  return `${count} ${count === 1 ? 'run' : 'runs'}`;
}

/** The rule as the design words it; each enabled limit is one clause (they form a union). */
export function policySentence(policy: RetentionPolicy): string {
  if (policy.mode === 'manual') return 'Retention is manual: runs are removed only when someone deletes them.';
  const clauses = [
    policy.ageDays === undefined ? null : `remove finished runs older than ${policy.ageDays} days`,
    policy.completedRunCount === undefined ? null : `keep only the newest ${policy.completedRunCount} finished runs`,
    policy.storageBytes === undefined ? null : `keep stored runs under ${bytes(policy.storageBytes)}`,
  ].filter((clause): clause is string => clause !== null);
  return `Rule: ${clauses.join('; ')}.`;
}

/** "Why" column for one candidate, using the limit captured with the preview. */
export function reasonLabel(reason: RetentionCandidate['reason'], policy: RetentionPolicy): string {
  const limits: { ageDays?: number; completedRunCount?: number; storageBytes?: number } =
    policy.mode === 'enabled' ? policy : {};
  switch (reason) {
    case 'age':
      return limits.ageDays === undefined ? 'Past the age limit' : `Older than ${limits.ageDays} days`;
    case 'completed_count':
      return limits.completedRunCount === undefined
        ? 'Beyond the finished-run count'
        : `Beyond the newest ${limits.completedRunCount}`;
    case 'storage_budget':
      return limits.storageBytes === undefined ? 'Over the storage limit' : `Over ${bytes(limits.storageBytes)}`;
    case 'manual':
      return 'Deleted by hand';
  }
}

const exclusionCopy: Record<ProtectedExclusion['reason'], { before?: string; after?: string; note: string }> = {
  active: { before: 'unfinished', note: 'Unfinished runs are never removed.' },
  pinned: { before: 'pinned', note: 'Pinned runs stay until you unpin them.' },
  referenced_input: { after: 'still referenced', note: 'Kept while something still refers to them.' },
  cleanup_in_progress: { after: 'already being cleaned up', note: 'Counted once that cleanup finishes.' },
  unknown: { after: 'with unreadable state', note: 'Kept because their state or size could not be read.' },
};

/** "2 pinned runs, 3.1 GB" plus its explanation; a missing size says so. */
export function exclusionLine(item: ProtectedExclusion): { title: string; note: string } {
  const copy = exclusionCopy[item.reason];
  const words = [String(item.count), copy.before, item.count === 1 ? 'run' : 'runs', copy.after].filter(Boolean);
  const size = item.estimatedBytes === null ? 'size unknown' : bytes(item.estimatedBytes);
  return { title: `${words.join(' ')}, ${size}`, note: copy.note };
}

/** Kept-by-protection total. Bytes are summed only when every group reports them. */
export function exclusionTotal(items: readonly ProtectedExclusion[]): string {
  const count = items.reduce((sum, item) => sum + item.count, 0);
  if (count === 0) return 'None';
  const known = items.every((item) => item.count === 0 || item.estimatedBytes !== null);
  const total = items.reduce((sum, item) => sum + (item.estimatedBytes ?? 0), 0);
  return `${runs(count)}, ${known ? bytes(total) : 'size unknown'}`;
}

export interface Stage {
  readonly phases: readonly RetentionStatusItem['phase'][];
  readonly label: string;
  readonly meaning: string;
  /** Design stages always show; the others only when a run is in them. */
  readonly always: boolean;
}
export const stages: readonly Stage[] = [
  { phases: ['settled'], label: 'Removed', meaning: 'Files gone and the storage credit confirmed.', always: true },
  {
    phases: ['preview', 'admitted'],
    label: 'Waiting to start',
    meaning: 'Accepted; cleanup has not begun.',
    always: false,
  },
  {
    phases: ['backend_files'],
    label: 'Removing result files',
    meaning: 'The server is deleting reports, metrics and artifacts.',
    always: true,
  },
  {
    phases: ['agent_cleanup'],
    label: 'Agent cleaning up',
    meaning: 'The agent is removing its copies of logs and output.',
    always: true,
  },
  {
    phases: ['settling'],
    label: 'Settling',
    meaning: 'Final bookkeeping; the storage credit is confirmed when this ends.',
    always: true,
  },
  { phases: ['blocked'], label: 'Blocked', meaning: 'Cleanup failed. See below.', always: true },
];

const errorCopy: Record<NonNullable<RetentionStatusItem['error']>, string> = {
  unavailable: 'Cleanup reported its storage as unavailable.',
  conflict: 'The run changed while it was being removed.',
  capacity_unavailable: 'Cleanup is waiting for capacity.',
  cleanup_failed: 'Cleanup could not remove its files.',
};
export function itemProblem(item: RetentionStatusItem): string {
  return item.error === null ? 'Cleanup is blocked.' : errorCopy[item.error];
}

export function kindLabel(kind: RetentionBatchSummary['kind']): string {
  return kind === 'manual' ? 'Run deleted by hand' : 'Retention';
}

/** Saved batch result; an unapplied preview past its expiry can no longer be applied. */
export function batchResult(item: Pick<RetentionBatchSummary, 'state' | 'expiresAt'>): {
  label: string;
  tone: StatusTone;
} {
  if (item.state === 'completed') return { label: 'Completed', tone: 'pass' };
  if (item.state === 'applied') return { label: 'Removing', tone: 'running' };
  return Date.parse(item.expiresAt) <= Date.now()
    ? { label: 'Preview expired', tone: 'skipped' }
    : { label: 'Preview, not applied', tone: 'info' };
}
