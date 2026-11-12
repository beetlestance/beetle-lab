// @vitest-environment jsdom
import { historyPage } from '../test-fixtures.js';
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { mount } from '../../../app/test-fixtures.js';
import { routes } from '../../../app/routes.js';
import { catalogue, json, scope, snapshot, testClient } from './fixtures.js';
afterEach(cleanup);
it('permits only four terminal runs and preserves the explicit baseline order', async () => {
  const base = snapshot().items[0]!.run;
  const runs = Array.from({length: 6}, (_, index) => ({...base, id: `11111111-1111-4111-8111-${String(index).padStart(12, '0')}`}));
  const fixture = testClient(request => request.path.endsWith('/comparisons') ? json(snapshot(null, request.body?.runIds as string[]))
    : request.path.includes('/metrics?') ? json({...catalogue(), id: runs[2]!.id})
    : json(historyPage([...runs.slice(0, 5), {...runs[5]!, state: 'queued' as const, outcome: 'pending' as const}].sort((a,b) => b.id.localeCompare(a.id)),base.scope)));
  mount(fixture.client, routes.runs(scope.organizationId, scope.workspaceId));
  const visible = await screen.findAllByRole('checkbox'); const boxes = [...visible].reverse(); expect(boxes[5]).toBeDisabled();
  [2, 0, 3, 1].forEach(index => fireEvent.click(boxes[index]!));
  expect(boxes[4]).toBeDisabled();
  expect(screen.getByRole('link', {name: 'Compare selected runs'})).toHaveAttribute('href', routes.comparison(scope.organizationId, scope.workspaceId, [runs[2]!.id, runs[0]!.id, runs[3]!.id, runs[1]!.id]));
  fireEvent.click(boxes[0]!); expect(boxes[4]).toBeEnabled();
  fireEvent.click(screen.getByRole('button', {name: 'Clear selection'}));
  expect(screen.queryByRole('link', {name: 'Compare selected runs'})).not.toBeInTheDocument();
  [2, 0].forEach(index => fireEvent.click(boxes[index]!));
  fireEvent.click(screen.getByRole('link', {name: 'Compare selected runs'}));
  await screen.findByRole('heading', {name: 'Compare runs'}); await screen.findByLabelText('Baseline metric');
});
