// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import {act, cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {afterEach, expect, it, vi} from 'vitest';
import type {ArtifactRead} from '../../../lib/verified-artifact.js';
import {ApiContext} from '../../../app/api.js';
import {testClient} from '../../../app/test-fixtures.js';
import source from '../../../../../contracts/fixtures/valid/k6-diagnostics.json' with {type: 'json'};
import {captureK6Diagnostics} from '@beetle/contracts/k6-diagnostics';
import type {K6Diagnostics} from '@beetle/contracts/k6-diagnostics';
import {DiagnosticSummary, PublishedDiagnostics} from './index.js';
const reader = vi.hoisted(() => ({read: vi.fn<(input: ArtifactRead) => Promise<K6Diagnostics>>()}));
vi.mock('./read.js', () => ({diagnosticReads: reader}));
afterEach(() => {cleanup(); vi.resetAllMocks();});
const params = {...source.scope, runId: '00000000-0000-4000-8000-000000000003'};
const artifact = {artifactId: '00000000-0000-4000-8000-000000000005', bytes: 500, sha256: 'a'.repeat(64), kind: 'k6-diagnostics', relativePath: 'k6-diagnostics.json', sealedAt: '2026-01-01T00:00:00Z'};
function surface(selection = params) {
  return <ApiContext.Provider value={testClient(() => {throw new Error('No JSON calls expected');}).client}>
    <PublishedDiagnostics params={selection} artifacts={[artifact]} />
  </ApiContext.Provider>;
}
it('explains incomplete capture, redaction and ordered fixed messages', () => {
  render(<DiagnosticSummary report={captureK6Diagnostics({...source, coverage: 'partial'})} />);
  expect(screen.getByText(/incomplete/)).toBeVisible(); expect(screen.getByText(/Redacted records: 1/)).toBeVisible();
  expect(screen.getByRole('listitem')).toHaveTextContent('#1 [error] Native diagnostic details redacted.');
});
it('reads only after explicit open, closes the display lease, and ignores a held late reply', async () => {
  let resolve!: (value: K6Diagnostics) => void;
  reader.read.mockReturnValue(new Promise<K6Diagnostics>(done => {resolve = done;}));
  render(surface()); expect(reader.read).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', {name: 'View diagnostic history'}));
  await waitFor(() => expect(reader.read).toHaveBeenCalledTimes(1)); const signal = reader.read.mock.calls[0]![0].signal;
  fireEvent.click(screen.getByRole('button', {name: 'Close diagnostic history'})); expect(signal.aborted).toBe(true);
  await act(async () => resolve(captureK6Diagnostics(source))); expect(screen.queryByRole('listitem')).toBeNull();
});
it('requires explicit retry after verification failure and retires selected scope state', async () => {
  reader.read.mockRejectedValueOnce(new Error('SECRET')).mockResolvedValueOnce(captureK6Diagnostics(source));
  const view = render(surface()); fireEvent.click(screen.getByRole('button', {name: 'View diagnostic history'}));
  await screen.findByRole('alert'); expect(screen.queryByText('SECRET')).toBeNull(); expect(reader.read).toHaveBeenCalledTimes(1);
  fireEvent.click(screen.getByRole('button', {name: 'Retry diagnostic history'})); await screen.findByRole('listitem');
  view.rerender(surface({...params, attemptId: '00000000-0000-4000-8000-000000000009'}));
  expect(screen.queryByRole('listitem')).toBeNull(); expect(reader.read).toHaveBeenCalledTimes(2);
  expect(screen.getByRole('button', {name: 'View diagnostic history'})).toBeVisible();
});
