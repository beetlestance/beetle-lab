// A finished run behind the Delete run dialog: the minimum the result page reads, plus the
// retention preview that "Delete this run" shows before anything is removed.
import type { Api, Json } from '../../harness.js';
import { NOW } from '../../harness.js';
import { fixture, ids } from '../index.js';
import { runId, runOf, specs } from './list.js';
import { liveIds } from './live-data.js';

const scope = { kind: 'workspace', organizationId: ids.organization, workspaceId: ids.workspace };
export const unpinned = specs.find((spec) => spec.short === '405b')!;
export const pinned = specs.find((spec) => spec.short === 'c3d1')!;

export function resultPagePath(short: string): string {
  return `/organizations/${ids.organization}/workspaces/${ids.workspace}/runs/${runId(short)}`;
}

export function installResultPage(api: Api, spec: typeof unpinned, run: Json = runOf(spec)) {
  let lastIntent: Json | undefined;
  const current = run as {
    id: string;
    activeAttemptId: string;
    revisionId: string;
    revisionDigest: string;
    suiteId: string;
  };
  api
    .on('getRun', run)
    .on('getRunResult', { ...fixture('run-result-pending'), id: current.id, activeAttemptId: current.activeAttemptId })
    .on('listRuns', { scope, items: [run], nextCursor: null, summaries: [], contexts: [] } as Json)
    .on('getRunMetricOverview', {
      ...fixture('run-metric-overview'),
      id: current.id,
      attemptId: current.activeAttemptId,
    })
    .on('getRunChartHistory', { ...fixture('run-chart-history'), id: current.id, attemptId: current.activeAttemptId })
    .on('getSuite', { ...fixture('suite'), id: current.suiteId, name: 'steady-1.2k' })
    .on('getSuiteRevision', {
      ...fixture('suite-revision'),
      id: current.revisionId,
      suiteId: current.suiteId,
      ordinal: 4,
      digest: current.revisionDigest,
    })
    .on('getWorkspaceSettings', { ...fixture('workspace-settings'), scope })
    .on('listWorkspaceRetention', { scope, items: [] })
    .on('previewRunDeletion', (call) => {
      lastIntent = call.body;
      return manualPreview(current.id, call.body);
    })
    .on('getWorkspaceRetentionPreview', () => manualPreview(current.id, lastIntent))
    .on('getWorkspaceRetentionStatus', batchStatus(current.id));
  void liveIds;
}

const snapshotId = '00000000-0000-4000-8000-000000000021';
const bytes = 1_503_238_554;
const life = { capturedAt: NOW, expiresAt: new Date(Date.parse(NOW) + 900_000).toISOString() };

/** The manual-run preview echoes the request's intent: request id, settings and run version. */
function manualPreview(id: string, body?: Json): Json {
  const intent = (body ?? {}) as {
    requestId?: string;
    settingsId?: string;
    expectedVersion?: number;
    expectedRunVersion?: number;
  };
  return {
    ...fixture('manual-retention-preview'),
    scope,
    snapshotId,
    ...(intent.requestId ? { requestId: intent.requestId } : {}),
    ...(intent.settingsId ? { settingsId: intent.settingsId } : {}),
    settingsVersion: intent.expectedVersion ?? 1,
    kind: 'manual',
    candidates: [{ id, version: intent.expectedRunVersion ?? 1, scope, estimatedBytes: bytes, reason: 'manual' }],
    estimatedBytes: bytes,
    protectedExclusions: [],
    scanned: 1,
    ...life,
  } as Json;
}
function batchStatus(id: string): Json {
  const base = fixture<{ items: object[] }>('retention-batch-status');
  return {
    ...base,
    id: snapshotId,
    scope,
    kind: 'manual',
    estimatedLogicalBytes: bytes,
    items: [{ ...base.items[0], runId: id }],
    ...life,
  } as Json;
}
