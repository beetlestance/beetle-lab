// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { TextField } from './fields.js';
import { ValuePalette, useValueInsertion } from './ValuePalette.js';

afterEach(cleanup);
const config = {
  datasets: [{ id: 'users', kind: 'inline', rows: [{ cartId: 'synthetic' }] }],
  secrets: [{ name: 'api_token', provider: 'env', locator: 'DO_NOT_DISPLAY_LOCATOR' }],
};
function Editor({ locked = false, limit = 128 }: { locked?: boolean; limit?: number }) {
  const [value, set] = useState('before AFTER');
  const insert = useValueInsertion();
  return (
    <div onFocusCapture={insert.capture}>
      <fieldset disabled={locked}>
        <TextField label="Path" path="/requests/0/path" value={value} change={set} maxLength={limit} />
        <ValuePalette config={config} insert={insert.insert} />
      </fieldset>
      <output aria-label="Draft">{value}</output>
    </div>
  );
}
it('replaces the text selection, updates the React draft and restores the caret', () => {
  render(<Editor />);
  const field = screen.getByRole('textbox', { name: 'Path' }) as HTMLInputElement;
  field.focus();
  field.setSelectionRange(7, 12);
  fireEvent.click(screen.getByRole('button', { name: '{{data.users.cartId}}' }));
  expect(screen.getByLabelText('Draft')).toHaveTextContent('before {{data.users.cartId}}');
  expect(document.activeElement).toBe(field);
  expect(field.selectionStart).toBe(field.value.length);
  expect(screen.queryByText('DO_NOT_DISPLAY_LOCATOR')).not.toBeInTheDocument();
});
it('refuses insertion without a target or beyond the field limit and keeps the draft', () => {
  render(<Editor limit={12} />);
  const button = screen.getByRole('button', { name: '{{secret.api_token}}' });
  fireEvent.click(button);
  expect(screen.getByRole('alert')).toHaveTextContent('Choose a text field');
  screen.getByRole('textbox', { name: 'Path' }).focus();
  fireEvent.click(button);
  expect(screen.getByLabelText('Draft')).toHaveTextContent('before AFTER');
});
it('disables the palette together with its owning read-only or pending fieldset', () => {
  render(<Editor locked />);
  expect(screen.getByRole('button', { name: '{{secret.api_token}}' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: '{{secret.api_token}}' }));
  expect(screen.getByLabelText('Draft')).toHaveTextContent('before AFTER');
});
it('names unknown file columns instead of inventing clickable values', () => {
  render(
    <ValuePalette
      config={{ datasets: [{ id: 'users', kind: 'csv', input: { id: 'synthetic' } }] }}
      insert={() => true}
    />,
  );
  expect(screen.queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getByText('Column names for input files are not available here yet.')).toBeInTheDocument();
});
