// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import type { RetentionBatchStatus, RetentionPreview } from '@beetle/contracts/api';
import { routes } from '../../app/routes.js';
import { fixture, id, ids, json, preview as proposal, scope, status } from './test-fixtures.js';
afterEach(cleanup);

const runIds = Array.from({ length: 10 }, (_, index) => `${String(index).repeat(8)}-aaaa-4aaa-8aaa-${'a'.repeat(12)}`);

function wide(): RetentionPreview {
  const base = proposal({ requestId: ids.request, settingsId: ids.request, expectedVersion: 1 });
  return {
    ...base,
    policy: { mode: 'enabled', ageDays: 90 },
    scanned: 40,
    candidates: runIds.map((runId) => ({ id: runId, version: 3, scope, reason: 'age', estimatedBytes: 1073741824 })),
    estimatedBytes: 10 * 1073741824,
    protectedExclusions: [
      { reason: 'pinned', count: 2, estimatedBytes: 3328599654 },
      { reason: 'active', count: 1, estimatedBytes: null },
      { reason: 'cleanup_in_progress', count: 0, estimatedBytes: 0 },
    ],
  };
}

const phases: RetentionBatchStatus['items'][number]['phase'][] = [
  'settled',
  'settled',
  'settled',
  'settled',
  'settled',
  'backend_files',
  'backend_files',
  'agent_cleanup',
  'settling',
  'blocked',
];

function progress(value: RetentionPreview): RetentionBatchStatus {
  return {
    ...status(value, 'applied'),
    completedCount: 5,
    refundedLogicalBytes: 5 * 1073741824,
    items: runIds.map((runId, index) => ({
      runId,
      runVersion: 3,
      deletionId: runId.replace('aaaa-4aaa', 'bbbb-4bbb'),
      phase: phases[index]!,
      fileCount: 4,
      preparedCount: 4,
      absentCount: ['backend_files', 'blocked'].includes(phases[index]!) ? 1 : 4,
      error: phases[index] === 'blocked' ? 'cleanup_failed' : null,
      refundedLogicalBytes: index < 5 ? 1073741824 : 0,
    })),
  };
}

async function openSaved(f: ReturnType<typeof fixture>) {
  f.mount();
  fireEvent.click(screen.getByRole('button', { name: 'Manage run retention' }));
  fireEvent.click(await screen.findByRole('button', { name: `Open batch ${id}` }));
}

it('renders the Retention preview board from the stored page without inventing suite or finish columns', async () => {
  const f = fixture();
  f.storePreview(wide());
  await openSaved(f);
  expect(await screen.findByRole('heading', { name: 'Preview: 10 runs would be removed' })).toBeVisible();
  expect(screen.getByText(/Rule: remove finished runs older than 90 days\. Checked at/)).toBeInTheDocument();
  expect(screen.getByText('10 GB')).toBeInTheDocument();
  expect(screen.getByText('3 runs, size unknown')).toBeInTheDocument();
  const table = screen.getByRole('table', { name: 'Runs this preview would remove' });
  expect(within(table).queryByText('Suite')).not.toBeInTheDocument();
  expect(within(table).queryByText('Finished')).not.toBeInTheDocument();
  expect(within(table).getAllByText('Older than 90 days')).toHaveLength(7);
  expect(within(table).getByText(/…and 3 more\./)).toBeInTheDocument();
  fireEvent.click(within(table).getByRole('button', { name: 'Show all 10' }));
  expect(within(table).getAllByText('Older than 90 days')).toHaveLength(10);
  const kept = screen.getByRole('region', { name: 'Never removed by this preview' });
  expect(within(kept).getByText('2 pinned runs, 3.1 GB')).toBeInTheDocument();
  expect(within(kept).getByText('1 unfinished run, size unknown')).toBeInTheDocument();
  expect(within(kept).queryByText(/already being cleaned up/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Remove 10 runs' })).toBeEnabled();
  expect(f.records.every((request) => request.method === 'GET')).toBe(true);
});

it('renders Retention progress stages and a blocked run from status only', async () => {
  const saved = wide();
  const f = fixture((request) => (request.path.endsWith('/' + id) ? json(progress(saved)) : undefined));
  f.storePreview(saved);
  await openSaved(f);
  expect(await screen.findByRole('heading', { name: 'Removing 10 runs' })).toBeVisible();
  const region = screen.getByRole('region', { name: 'Deletion progress' });
  expect(within(region).getByText('5 of 10 removed')).toBeInTheDocument();
  expect(within(region).getByText('5 GB of about 10 GB returned to the storage budget')).toBeInTheDocument();
  expect(within(region).getByRole('progressbar', { name: 'Runs removed' })).toHaveAttribute('value', '5');
  const stages = within(region).getByRole('table', { name: 'Removal stages' });
  const count = (label: string) => within(stages).getByText(label).closest('tr')!.children[1]!.textContent;
  expect([
    count('Removed'),
    count('Removing result files'),
    count('Agent cleaning up'),
    count('Settling'),
    count('Blocked'),
  ]).toEqual(['5', '2', '1', '1', '1']);
  expect(within(stages).queryByText('Waiting to start')).not.toBeInTheDocument();
  const alert = within(region).getByRole('alert');
  expect(within(alert).getByText('Run 9999 is blocked')).toBeInTheDocument();
  expect(alert).toHaveTextContent('Cleanup could not remove its files. The run stays listed and its estimated 1 GB');
  expect(within(alert).getByRole('link', { name: 'Open run 9999' })).toHaveAttribute(
    'href',
    routes.run(scope.organizationId, scope.workspaceId, runIds[9]!),
  );
  expect(screen.queryByRole('button', { name: 'Acknowledge completed batch' })).not.toBeInTheDocument();
});

it('lists saved batches without a freed column and labels an expired preview', async () => {
  const capturedAt = new Date(Date.now() - 900001).toISOString();
  const f = fixture();
  f.storePreview({ ...wide(), capturedAt, expiresAt: new Date(Date.parse(capturedAt) + 900000).toISOString() });
  f.mount();
  fireEvent.click(screen.getByRole('button', { name: 'Manage run retention' }));
  const table = await screen.findByRole('table', { name: 'Saved retention batches' });
  expect(within(table).queryByText('Freed')).not.toBeInTheDocument();
  expect(within(table).getByText('Preview expired')).toBeInTheDocument();
  expect(within(table).getByText('Retention')).toBeInTheDocument();
  expect(within(table).getByText('10')).toBeInTheDocument();
});
