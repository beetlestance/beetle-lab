// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { ApiContext } from '../../../app/api.js';
import type { ArtifactReader } from '../../../lib/use-artifact-report.js';
import { ArtifactViewer } from './ArtifactViewer.js';
import { artifact, artifactId, json, mountArtifacts, page, run, testClient } from './fixtures.js';

afterEach(cleanup);
const text = '{"metrics":{"http_reqs":8}}';
const summary = { ...artifact(), artifactId, kind: 'numeric-final', relativePath: 'summary.json', bytes: 27, sha256: 'c'.repeat(64) };
const current = run();
const params = {
  organizationId: current.scope.organizationId,
  workspaceId: current.scope.workspaceId,
  runId: current.id,
  attemptId: current.activeAttemptId,
};
function viewer(reads: ArtifactReader<string>, onClose = vi.fn()) {
  const api = testClient(() => json({})).client;
  render(
    <ApiContext.Provider value={api}>
      <ArtifactViewer params={params} artifact={summary} reads={reads} onClose={onClose} />
    </ApiContext.Provider>,
  );
  return onClose;
}

it('offers Verify and open only for small text kinds; every row keeps Download', async () => {
  const value = page();
  value.items = [summary, { ...artifact(1), kind: 'raw' }];
  mountArtifacts(testClient(() => json(value)).client);
  expect(await screen.findByText('Final k6 numbers as JSON')).toBeVisible();
  expect(screen.getByRole('button', { name: 'Verify and open summary.json' })).toBeVisible();
  expect(screen.queryByRole('button', { name: 'Verify and open reports/file-1.bin' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('link', { name: /^Download artifact/ })).toHaveLength(2);
});

it('shows indented JSON only after the verified read, with Close and Download', async () => {
  const reads = { read: vi.fn(async () => text) };
  const onClose = viewer(reads);
  const dialog = await screen.findByRole('dialog', { name: 'summary.json' });
  expect(await within(dialog).findByText(/Size and SHA-256 match the sealed manifest/)).toBeVisible();
  expect(within(dialog).getByLabelText('Contents of summary.json').textContent).toBe(
    JSON.stringify(JSON.parse(text), null, 2),
  );
  expect(within(dialog).getByRole('link', { name: 'Download' })).toHaveAttribute('download', `artifact-${artifactId}.json`);
  expect(reads.read).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Close' }));
  expect(onClose).toHaveBeenCalledTimes(1);
});

it('shows no content when verification fails and retries only on request', async () => {
  const reads = { read: vi.fn(async () => Promise.reject(new Error('Artifact integrity mismatch'))) };
  viewer(reads);
  const dialog = await screen.findByRole('dialog');
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(/did not match the sealed manifest/);
  expect(within(dialog).queryByText(/Size and SHA-256 match/)).not.toBeInTheDocument();
  expect(reads.read).toHaveBeenCalledTimes(1);
  fireEvent.click(within(dialog).getByRole('button', { name: 'Verify again' }));
  await within(dialog).findByRole('alert');
  expect(reads.read).toHaveBeenCalledTimes(2);
});
