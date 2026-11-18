// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { Config } from '../suites/draft.js';
import { SetupDatasets } from './SetupDatasets.js';
import { datasetProblems } from './dataset-problems.js';
const file = {
  id: 'cccccccc-cccc-4ccc-8ccc-000000000001',
  name: 'users.csv',
  sha256: 'a'.repeat(64),
  bytes: 12,
  state: 'published',
};
const inputs = { choices: [file], loading: false, name: () => file.name };
afterEach(cleanup);
function Editor({ initial = {} }: { initial?: Config }) {
  const [config, set] = useState(initial);
  return (
    <>
      <SetupDatasets config={config} set={set} inputs={inputs} />
      <output aria-label="Configuration">{JSON.stringify(config)}</output>
    </>
  );
}
const draft = () => JSON.parse(screen.getByLabelText('Configuration').textContent!);
it('edits inline rows, keeps malformed text as an invalid draft and recovers without losing the row editor', () => {
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Add dataset' }));
  fireEvent.click(screen.getByRole('button', { name: 'Edit rows' }));
  const rows = screen.getByRole('textbox', { name: 'Dataset 1 rows (JSON array)' });
  fireEvent.change(rows, { target: { value: '[{"term":"shoes"},{"term":"jacket"}]' } });
  expect(draft().datasets[0].rows).toEqual([{ term: 'shoes' }, { term: 'jacket' }]);
  expect(datasetProblems(draft())).toEqual([]);
  fireEvent.change(rows, { target: { value: '[{"term":' } });
  expect(draft().datasets[0].rows).toBe('[{"term":');
  expect(datasetProblems(draft())[0]?.path).toBe('/datasets/0');
  fireEvent.change(rows, { target: { value: '[{"term":null}]' } });
  expect(draft().datasets[0].rows).toEqual([{ term: null }]);
  expect(datasetProblems(draft())).toEqual([]);
});
it('switches source without retaining incompatible fields, preserves selection and captures an immutable input identity', () => {
  render(
    <Editor
      initial={{
        target: 'http://synthetic.invalid',
        datasets: [{ id: 'users', kind: 'inline', selection: 'random', rows: [{ id: 1 }] }],
      }}
    />,
  );
  const source = screen.getByRole('combobox', { name: 'Dataset 1 rows from' });
  fireEvent.change(source, { target: { value: 'range' } });
  expect(draft().datasets[0]).toEqual({
    id: 'users',
    kind: 'range',
    selection: 'random',
    column: 'id',
    start: 1,
    end: 10000,
    step: 1,
  });
  fireEvent.change(screen.getByRole('textbox', { name: 'Dataset 1 end' }), { target: { value: '42' } });
  expect(draft().datasets[0].end).toBe(42);
  fireEvent.change(source, { target: { value: file.id } });
  expect(draft().datasets[0]).toEqual({
    id: 'users',
    kind: 'csv',
    selection: 'random',
    input: { id: file.id, sha256: file.sha256, bytes: 12 },
  });
  expect(draft().target).toBe('http://synthetic.invalid');
  expect(datasetProblems(draft())).toEqual([]);
});
