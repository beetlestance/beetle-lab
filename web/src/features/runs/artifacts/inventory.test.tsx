// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { runArtifactContentPath } from '@beetle/contracts/api';
import { artifact, artifactId, apiError, cursor, deferred, emptyEvents, json, mountArtifacts, page, resultSnapshot, run, testClient } from './fixtures.js';
afterEach(() => { cleanup(); vi.useRealTimers(); });

it('composes published descriptors in real RunDetail with browser-owned UUID links and no byte request or completion state', async () => {
  const fixture = testClient(request => {
    if (request.path.includes('/artifacts?')) return json(page());
    if (request.path.endsWith('/result')) return json(resultSnapshot());
    if (request.path.includes('/events?')) return json(emptyEvents());
    return json(run());
  });
  mountArtifacts(fixture.client, run(), false, true);
  const link = await screen.findByRole('link', { name: 'Download artifact reports/file-0.bin' });
  const current = run();
  expect(link).toHaveAttribute('href', runArtifactContentPath({ organizationId: current.scope.organizationId,
    workspaceId: current.scope.workspaceId, runId: current.id, attemptId: current.activeAttemptId, artifactId }));
  expect(link).toHaveAttribute('download', `artifact-${artifactId}.bin`);
  expect(screen.getByText('9007199254740991')).toBeVisible();
  expect(screen.getByText('b'.repeat(64))).toBeVisible();
  expect(screen.getByText(/Download progress and cancellation are handled by your browser/)).toBeVisible();
  // jsdom cannot save a file; prevent its unsupported navigation after checking native anchor behavior.
  link.addEventListener('click', event => event.preventDefault(), { once: true });
  const before = fixture.records.length; fireEvent.click(link);
  expect(fixture.records).toHaveLength(before);
  expect(screen.queryByText(/download complete|saved successfully|verified locally/i)).not.toBeInTheDocument();
  expect(fixture.records.some(request => request.path.endsWith('/content'))).toBe(false);
});

it.each(['pending', 'absent', 'empty'] as const)('distinguishes %s publication without links', async state => {
  const value = state === 'empty' ? { ...page(), items: [] } : page(run(), state);
  const fixture = testClient(() => json(value)); mountArtifacts(fixture.client);
  await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(state === 'pending' ? 'Artifact publication is pending.'
    : state === 'absent' ? 'No artifact source was published' : 'Published inventory is empty.'));
  expect(screen.queryByRole('link')).not.toBeInTheDocument();
});

it('retains one current page, disables overlapping actions and refreshes to a changed first manifest', async () => {
  const held = deferred<Response>(); let reads = 0;
  const first = { ...page(), items: Array.from({ length: 100 }, (_, index) => artifact(index)), nextCursor: cursor() };
  const fresh = { ...page(), manifestDigest: 'c'.repeat(64), items: [{ ...artifact(102), relativePath: 'new-manifest.bin' }] };
  const fixture = testClient(() => ++reads === 1 ? json(first) : reads === 2 ? held.promise : json(fresh));
  const view = mountArtifacts(fixture.client);
  await screen.findByText('reports/file-0.bin');
  expect(screen.getAllByRole('link')).toHaveLength(100);
  const next = screen.getByRole('button', { name: 'Next artifact page' });
  fireEvent.click(next); fireEvent.click(next); fireEvent.click(screen.getByRole('button', { name: 'Refresh artifacts' }));
  await waitFor(() => expect(reads).toBe(2));
  expect(next).toBeDisabled(); expect(screen.getByRole('button', { name: 'Refresh artifacts' })).toBeDisabled();
  expect(new URL(fixture.records[1]!.path, 'http://localhost').searchParams.get('cursor')).toBe(cursor());
  await act(async () => held.resolve(json({ ...page(), items: [artifact(100)] })));
  expect(await screen.findByText('reports/file-100.bin')).toBeVisible();
  expect(screen.queryByText('reports/file-0.bin')).not.toBeInTheDocument();
  expect(view.client.getQueryCache().findAll()).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Refresh artifacts' }));
  expect(await screen.findByText('new-manifest.bin')).toBeVisible();
  expect(fixture.records[2]!.path).toMatch(/artifacts\?limit=100$/);
  expect(screen.queryByText('reports/file-100.bin')).not.toBeInTheDocument();
});

it.each(['http', 'foreign', 'path', 'manifest'] as const)('reports %s failures and requires explicit retry', async failure => {
  vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval'] });
  const wrong = page();
  if (failure === 'foreign') wrong.attemptId = artifactId;
  if (failure === 'path') wrong.items[0]!.relativePath = '<img src=x onerror=alert(1)>';
  if (failure === 'manifest') wrong.nextCursor = cursor(run(), 'c'.repeat(64));
  let failed = true;
  const fixture = testClient(() => failed ? failure === 'http' ? json(apiError('storage_unavailable'), 503) : json(wrong) : json(page()));
  mountArtifacts(fixture.client);
  expect(await screen.findByRole('alert')).toHaveTextContent('Artifact inventory could not be loaded');
  await act(() => vi.advanceTimersByTimeAsync(6000)); expect(fixture.records).toHaveLength(1);
  expect(screen.queryByRole('link')).not.toBeInTheDocument(); expect(document.querySelector('img')).toBeNull();
  failed = false; fireEvent.click(screen.getByRole('button', { name: 'Refresh artifacts' }));
  expect(await screen.findByText('reports/file-0.bin')).toBeVisible();
  expect(fixture.records).toHaveLength(2);
});

it('renders safe relative path as text only; punctuation never becomes a file selector', async () => {
  const value = page(); value.items[0]!.relativePath = 'reports/a.b-c_d.bin';
  const fixture = testClient(() => json(value)); mountArtifacts(fixture.client);
  const link = await screen.findByRole('link');
  expect(screen.getByText('reports/a.b-c_d.bin')).toHaveProperty('tagName', 'SPAN');
  expect(link.getAttribute('href')).not.toContain('reports');
  expect(link.getAttribute('download')).not.toContain('reports');
});
