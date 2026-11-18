// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { parseDraft, starter } from '../suites/draft.js';
import { SetupScenarios } from './SetupScenarios.js';
afterEach(cleanup);
function Editor() {
  const [config, set] = useState(parseDraft(starter()));
  return (
    <>
      <SetupScenarios config={config} set={set} />
      <output aria-label="Draft">{JSON.stringify(config)}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByLabelText('Draft').textContent!);
it('adds a scenario with all request selections and removes only its own plan and selection', () => {
  render(<Editor />);
  const original = draft();
  fireEvent.click(screen.getByRole('button', { name: 'Add scenario' }));
  const added = draft();
  expect(added.loadPlan.scenarios).toHaveLength(2);
  expect(added.selections[1]).toMatchObject({ scenarioId: 'scenario', entries: [{ requestId: 'get', weight: 1 }] });
  fireEvent.change(screen.getAllByRole('combobox', { name: 'Executor' })[1]!, { target: { value: 'ramping-vus' } });
  expect(draft().loadPlan.scenarios[1]).toMatchObject({ id: 'scenario', name: 'scenario', executor: 'ramping-vus' });
  expect(screen.getAllByRole('textbox', { name: 'Stage 1 duration' })).toHaveLength(1);
  fireEvent.click(screen.getByRole('button', { name: 'Remove scenario 2' }));
  expect(draft()).toEqual(original);
});
it('edits the displayed scenario name without changing its stable selection identifier', () => {
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Rename scenario 1: Main' }));
  const name = screen.getByRole('textbox', { name: 'Scenario 1 name' });
  fireEvent.change(name, { target: { value: 'steady' } });
  fireEvent.keyDown(name, { key: 'Enter' });
  expect(screen.getByRole('button', { name: 'Rename scenario 1: steady' })).toBeVisible();
  expect(draft().loadPlan.scenarios[0]).toMatchObject({ id: 'main', name: 'steady' });
  expect(draft().selections[0].scenarioId).toBe('main');
});
