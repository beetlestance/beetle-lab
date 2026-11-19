// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, screen, within, fireEvent, act } from '@testing-library/react';
import { historyPage } from '../test-fixtures.js';
import { catalogue, json, mountComparison, snapshot, testClient, apiError, deferred } from './fixtures.js';
afterEach(cleanup);
function fixture(mismatch = false, failure = { value: false }) {
  const items = snapshot().items;
  return testClient((request) => {
    if (request.path.endsWith('/comparisons'))
      return failure.value ? json(apiError('storage_unavailable'), 503) : json(snapshot());
    if (request.path.includes('/runs?')) {
      const id = new URL(request.path, 'http://localhost').searchParams.get('runIdPrefix');
      const run = items.find((item) => item.run.id === id)!.run;
      const record = mismatch ? { ...run, revisionId: '99990000-0000-4000-8000-000000000001' } : run;
      return json({
        ...historyPage([record], record.scope),
        workspaceName: 'checkout-workspace',
        contexts: [
          {
            runId: record.id,
            suiteId: record.suiteId,
            revisionId: record.revisionId,
            suiteName: 'checkout-verified',
            revisionOrdinal: 7,
          },
        ],
      });
    }
    return json(catalogue());
  });
}
it('uses existing bound row metadata for baseline title and revision labels without extra requests', async () => {
  const f = fixture();
  mountComparison(f.client);
  await screen.findByRole('heading', { name: /2 runs, baseline checkout-verified/ });
  const revision = within(screen.getByRole('table', { name: 'What was different between the runs' }))
    .getByRole('rowheader', { name: 'Revision' })
    .closest('tr')!;
  expect(revision).toHaveTextContent('checkout-verified rev 7');
  expect(
    within(screen.getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'checkout-workspace' }),
  ).toBeVisible();
  const strip = screen.getByRole('table', { name: /difference from the baseline/ });
  expect(within(strip).getAllByText('revision 7')).toHaveLength(2);
  expect(f.records.filter((record) => record.path.includes('/runs?'))).toHaveLength(2);
  expect(f.records.some((record) => record.path.includes('/revisions/') || /\/suites\//.test(record.path))).toBe(false);
});
it('rejects row metadata bound to a different revision than the captured comparison run', async () => {
  mountComparison(fixture(true).client);
  await screen.findByLabelText('Baseline metric');
  expect(screen.getByRole('heading', { name: 'Compare runs' })).toBeVisible();
  expect(screen.queryByText('checkout-verified')).not.toBeInTheDocument();
  const revision = within(screen.getByRole('table', { name: 'What was different between the runs' }))
    .getByRole('rowheader', { name: 'Revision' })
    .closest('tr')!;
  expect(within(revision).getAllByText('Revision unknown')).toHaveLength(2);
  expect(
    within(screen.getByRole('table', { name: /difference from the baseline/ })).getAllByText('Revision unknown'),
  ).toHaveLength(2);
});

it('does not mark different saved revisions equal when their display names and ordinals coincide', async () => {
  const items = snapshot().items;
  items[1]!.run.revisionId = '99990000-0000-4000-8000-000000000001';
  const f = testClient((req) => {
    if (req.path.endsWith('/comparisons')) return json({ ...snapshot(), items });
    if (req.path.includes('/runs?')) {
      const id = new URL(req.path, 'http://localhost').searchParams.get('runIdPrefix');
      const run = items.find((i) => i.run.id === id)!.run;
      return json({
        ...historyPage([run], run.scope),
        contexts: [
          {
            runId: run.id,
            suiteId: run.suiteId,
            revisionId: run.revisionId,
            suiteName: 'same-name',
            revisionOrdinal: 7,
          },
        ],
      });
    }
    return json(catalogue());
  });
  mountComparison(f.client);
  await screen.findByRole('heading', { name: /baseline same-name/ });
  const row = within(screen.getByRole('table', { name: 'What was different between the runs' }))
    .getByRole('rowheader', { name: 'Revision' })
    .closest('tr')!;
  expect(within(row).getAllByText('same-name rev 7')).toHaveLength(2);
  expect(within(row).getAllByRole('cell')[1]).not.toHaveClass('muted');
});

it('retires mutable names after a failed comparison refresh and keeps board sections in order', async () => {
  const failure = { value: false };
  mountComparison(fixture(false, failure).client);
  await screen.findByRole('link', { name: 'checkout-workspace' });
  const headings = screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent);
  expect(
    screen
      .getByRole('region', { name: 'Native SLO comparisons' })
      .compareDocumentPosition(screen.getByRole('heading', { name: 'Recorded runs over time' })) &
      Node.DOCUMENT_POSITION_FOLLOWING,
  ).toBeTruthy();
  expect(headings.indexOf('Target runtime')).toBeLessThan(headings.indexOf('What was different'));
  failure.value = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh comparison' }));
  await screen.findByText('Comparison could not be loaded. Use Refresh comparison to retry.');
  expect(screen.queryByRole('link', { name: 'checkout-workspace' })).toBeNull();
  expect(screen.getByRole('heading', { name: 'Compare runs' })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Workspace name unavailable' })).toBeVisible();
});

it('never resurrects retired names while a retry original is pending', async () => {
  const failure = { value: false };
  const base = fixture(false, failure);
  const held = deferred<Awaited<ReturnType<typeof base.client.compareRuns>>>();
  let hold = false;
  const client = {
    ...base.client,
    compareRuns: (input: Parameters<typeof base.client.compareRuns>[0]) =>
      hold ? held.promise : base.client.compareRuns(input),
  };
  mountComparison(client);
  await screen.findByRole('link', { name: 'checkout-workspace' });
  failure.value = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh comparison' }));
  await screen.findByText('Comparison could not be loaded. Use Refresh comparison to retry.');
  failure.value = false;
  hold = true;
  fireEvent.click(screen.getByRole('button', { name: 'Refresh comparison' }));
  try {
    await act(async () => {
      await Promise.resolve();
    });
    expect(screen.queryByRole('link', { name: 'checkout-workspace' })).toBeNull();
  } finally {
    await act(async () => held.resolve({ ok: true, value: snapshot() }));
  }
  await screen.findByRole('link', { name: 'checkout-workspace' });
  expect(base.records.filter((r) => r.path.includes('/runs?'))).toHaveLength(4);
});
