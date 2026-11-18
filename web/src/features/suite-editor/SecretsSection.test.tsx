// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { SecretsSection } from './SecretsSection.js';
import { secretProblems } from './secret-problems.js';
import type { Config } from '../suites/draft.js';

afterEach(cleanup);
function Editor({ initial = {} }: { initial?: Config }) {
  const [config, set] = useState(initial);
  return (
    <>
      <SecretsSection config={config} set={set} />
      <output aria-label="Configuration">{JSON.stringify(config)}</output>
    </>
  );
}
const saved = () => JSON.parse(screen.getByLabelText('Configuration').textContent!);
it('edits only a secret declaration and preserves its version and other configuration fields', () => {
  render(
    <Editor
      initial={{
        target: 'http://synthetic.invalid',
        secrets: [{ name: 'token', provider: 'env', locator: 'OLD_REF', version: 'v1' }],
        requests: [{ method: 'POST', path: '/checkout', headers: { authorization: 'Bearer {{secret.token}}' } }],
      }}
    />,
  );
  expect(screen.getByText('Used in: POST /checkout (headers).')).toBeInTheDocument();
  fireEvent.change(screen.getByRole('combobox', { name: 'Secret 1 comes from' }), { target: { value: 'mounted' } });
  fireEvent.change(screen.getByRole('textbox', { name: 'Secret 1 binding reference' }), {
    target: { value: 'NEW_REF' },
  });
  expect(saved()).toMatchObject({
    target: 'http://synthetic.invalid',
    secrets: [{ name: 'token', provider: 'mounted', locator: 'NEW_REF', version: 'v1' }],
  });
  expect(screen.queryByLabelText('Secret value')).not.toBeInTheDocument();
});
it('adds unique references, validates missing or path-like bindings and removes only the chosen declaration', () => {
  render(<Editor />);
  fireEvent.click(screen.getByRole('button', { name: 'Add secret' }));
  fireEvent.click(screen.getByRole('button', { name: 'Add secret' }));
  expect(saved().secrets.map((secret: { name: string }) => secret.name)).toEqual(['api_token', 'api_token_2']);
  expect(secretProblems(saved())).toHaveLength(2);
  fireEvent.change(screen.getByRole('textbox', { name: 'Secret 1 binding reference' }), {
    target: { value: '/arbitrary/host/path' },
  });
  expect(secretProblems(saved())[0]?.path).toBe('/secrets/0/locator');
  fireEvent.change(screen.getByRole('textbox', { name: 'Secret 1 binding reference' }), {
    target: { value: 'CHECKOUT_API_TOKEN' },
  });
  fireEvent.click(screen.getByRole('button', { name: 'Remove secret 2' }));
  expect(saved().secrets).toEqual([{ name: 'api_token', provider: 'env', locator: 'CHECKOUT_API_TOKEN' }]);
  expect(secretProblems(saved())).toEqual([]);
});
