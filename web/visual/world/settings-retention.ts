// Retention fixtures for the "Checkout" workspace: a 38 run preview and its removal progress,
// shaped after the "Retention preview" and "Retention progress" boards.
import type { Api, Json } from '../harness.js';
import { NOW } from '../harness.js';
import { ids } from './index.js';

const GiB = 1_073_741_824;
const gib = (value: number) => Math.round(value * GiB);
const MINUTE = 60_000;
const ago = (minutes: number) => new Date(Date.parse(NOW) - minutes * MINUTE).toISOString();
const ahead = (minutes: number) => new Date(Date.parse(NOW) + minutes * MINUTE).toISOString();

export const snapshotId = 'ba7c0000-0000-4000-8000-0000000000b1';
const scope = { kind: 'workspace', organizationId: ids.organization, workspaceId: ids.workspace } as const;

/** The first seven rows are the board's runs; the rest fill the total to 61.2 GB. */
const listed: [string, number][] = [
  ['7e1a', 1.4],
  ['b20c', 2.2],
  ['91fd', 2.1],
  ['44e7', 3.6],
  ['0ac3', 0.9],
  ['e5b8', 2.0],
  ['3f61', 1.5],
];
const total = 38;
const totalGib = 61.25;
const runId = (prefix: string, n: number) => `${prefix}0000-0000-4000-8000-${String(n).padStart(12, '0')}`;

interface Candidate {
  id: string;
  version: number;
  scope: Json;
  estimatedBytes: number;
  reason: string;
}
function candidates(): Candidate[] {
  const rest = total - listed.length;
  const filler = Math.round(((totalGib - listed.reduce((sum, [, size]) => sum + size, 0)) / rest) * 100) / 100;
  const rows = [
    ...listed,
    ...Array.from({ length: rest }, (_, n): [string, number] => [`d${(n + 16).toString(16).padStart(3, '0')}`, filler]),
  ];
  return rows.map(([prefix, size], n) => ({
    id: runId(prefix, n + 1),
    version: 3,
    scope,
    estimatedBytes: gib(size),
    reason: 'age',
  }));
}

export const blockedRun = runId('44e7', 4);

export function preview(): Json {
  const items = candidates();
  return {
    snapshotId,
    version: 1,
    scope,
    requestId: '00000000-0000-4000-8000-0000000000b2',
    settingsId: '00000000-0000-4000-8000-000000000020',
    settingsVersion: 1,
    policy: { mode: 'enabled', ageDays: 90 },
    candidates: items as unknown as Json,
    estimatedBytes: items.reduce((sum, item) => sum + item.estimatedBytes, 0),
    protectedExclusions: [
      { reason: 'pinned', count: 2, estimatedBytes: gib(3.1) },
      { reason: 'active', count: 1, estimatedBytes: 0 },
      { reason: 'cleanup_in_progress', count: 1, estimatedBytes: gib(0.8) },
    ],
    nextCursor: null,
    kind: 'retention',
    capturedAt: ago(5),
    expiresAt: ahead(10),
    scanned: 100,
  };
}

type Phase = 'backend_files' | 'agent_cleanup' | 'settling' | 'settled' | 'blocked';
/** 31 removed, 3 deleting result files, 2 in agent cleanup, 1 settling, 1 blocked (run 44e7). */
function phases(items: Candidate[]): Phase[] {
  const plan: Phase[] = [
    ...Array<Phase>(31).fill('settled'),
    ...Array<Phase>(3).fill('backend_files'),
    ...Array<Phase>(2).fill('agent_cleanup'),
    'settling',
    'blocked',
  ];
  const blocked = items.findIndex((item) => item.id === blockedRun);
  const last = plan.length - 1;
  [plan[blocked], plan[last]] = [plan[last]!, plan[blocked]!];
  return plan;
}

export function status(state: 'preview' | 'applied'): Json {
  const items = candidates();
  const plan = phases(items);
  const applied = state === 'applied';
  const refunded = items.filter((_, n) => plan[n] === 'settled').reduce((sum, item) => sum + item.estimatedBytes, 0);
  return {
    id: snapshotId,
    scope,
    kind: 'retention',
    state,
    capturedAt: ago(applied ? 9 : 5),
    expiresAt: ahead(applied ? 6 : 10),
    completedAt: null,
    estimatedLogicalBytes: gib(totalGib),
    items: items.map((item, n) => ({
      runId: item.id,
      runVersion: 3,
      deletionId: runId('de1e', n + 1),
      phase: applied ? plan[n]! : 'preview',
      ...counts(applied ? plan[n]! : 'preview'),
      error: applied && plan[n] === 'blocked' ? 'cleanup_failed' : null,
      refundedLogicalBytes: applied && plan[n] === 'settled' ? item.estimatedBytes : 0,
    })),
    completedCount: applied ? 31 : 0,
    refundedLogicalBytes: applied ? refunded : 0,
    driverState: 'running',
  };
}

/** File counts the client requires per phase: finished phases removed every file. */
function counts(phase: Phase | 'preview') {
  if (phase === 'preview' || phase === 'blocked') return { fileCount: null, preparedCount: null, absentCount: null };
  if (phase === 'backend_files') return { fileCount: 12, preparedCount: 12, absentCount: 5 };
  return { fileCount: 12, preparedCount: 12, absentCount: 12 };
}

interface Summary {
  id: string;
  kind: string;
  state: string;
  captured: string;
  count: number;
  done: string | null;
}
function summary({ id, kind, state, captured, count, done }: Summary) {
  const expiresAt = new Date(Date.parse(captured) + 15 * MINUTE).toISOString();
  return { id, scope, kind, state, capturedAt: captured, expiresAt, completedAt: done, candidateCount: count };
}

/** Saved batches: the selected one first, then the earlier batches of the progress board. */
export function batchList(state: 'preview' | 'applied'): Json {
  const captured = ago(state === 'applied' ? 9 : 5);
  const current = summary({ id: snapshotId, kind: 'retention', state, captured, count: total, done: null });
  return {
    scope,
    items: [
      { ...current, expiresAt: ahead(state === 'applied' ? 6 : 10) },
      summary({
        id: 'b3c10000-0000-4000-8000-0000000000b3',
        kind: 'retention',
        state: 'completed',
        captured: '2026-10-17T09:02:00.000Z',
        count: 22,
        done: '2026-10-17T09:40:00.000Z',
      }),
      summary({
        id: 'b4d20000-0000-4000-8000-0000000000b4',
        kind: 'manual',
        state: 'completed',
        captured: '2026-10-02T14:31:00.000Z',
        count: 1,
        done: '2026-10-02T14:50:00.000Z',
      }),
      summary({
        id: 'b5e30000-0000-4000-8000-0000000000b5',
        kind: 'retention',
        state: 'preview',
        captured: '2026-09-28T08:15:00.000Z',
        count: 31,
        done: null,
      }),
    ],
  };
}

/** Answers the reads the retention controls make for one batch in the given state. */
export function retentionApi(api: Api, state: 'preview' | 'applied'): Api {
  return api
    .on('getWorkspaceRetentionPreview', preview())
    .on('getWorkspaceRetentionStatus', status(state))
    .on('listWorkspaceRetention', batchList(state));
}
