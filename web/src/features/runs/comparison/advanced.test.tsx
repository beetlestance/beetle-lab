// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { catalogue, json, mountComparison, snapshot, testClient, runIds, openComparisonExploration } from './fixtures.js';
afterEach(cleanup);

it('keeps overview first and exposes advanced controls without adding any reads on open or close', async () => {
  const f = testClient(request => json(request.path.endsWith('/comparisons') ? snapshot() : catalogue()));
  mountComparison(f.client);
  const metric = await screen.findByLabelText('Baseline metric');
  const disclosure = screen.getByText('Explore metrics and recorded evidence', { selector: 'summary' }).closest('details')!;
  expect(disclosure).not.toHaveAttribute('open');
  expect(metric).not.toBeVisible();
  expect(screen.getByRole('table', { name: 'What was different between the runs' })).toBeVisible();
  const reads = f.records.length;
  await openComparisonExploration();
  await waitFor(() => expect(disclosure).toHaveAttribute('open'));
  expect(metric).toBeVisible();
  expect(screen.getByRole('heading', { name: 'One metric, per run' })).toBeVisible();
  fireEvent.click(disclosure.querySelector('summary')!);
  await waitFor(() => expect(disclosure).not.toHaveAttribute('open'));
  expect(metric).not.toBeVisible();
  expect(f.records).toHaveLength(reads);
});

it('starts a different ordered selection collapsed instead of carrying old exploration state', async () => {
  const f = testClient(request => json(request.path.endsWith('/comparisons')
    ? snapshot(null, request.body?.runIds as string[])
    : { ...catalogue(), id: runIds.find(id => request.path.includes(id)) ?? runIds[0]! }));
  mountComparison(f.client);
  await screen.findByLabelText('Baseline metric'); await openComparisonExploration();
  const original = screen.getByText('Explore metrics and recorded evidence', { selector: 'summary' }).closest('details')!;
  expect(original).toHaveAttribute('open');
  fireEvent.click(screen.getByRole('button', { name: 'Reverse runs' }));
  await waitFor(() => expect(original).not.toBeInTheDocument());
  const next = await screen.findByText('Explore metrics and recorded evidence', { selector: 'summary' });
  expect(next.closest('details')).not.toHaveAttribute('open');
});
