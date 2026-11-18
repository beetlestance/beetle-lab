// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { SecondsField } from './fields.js';
afterEach(cleanup);
function Field() {
  const [value, set] = useState<number | string>(1000);
  return (
    <>
      <SecondsField label="Every, seconds" path="/readiness/intervalMs" value={value} change={set} />
      <output aria-label="Stored milliseconds">{JSON.stringify(value)}</output>
    </>
  );
}
it('preserves exact millisecond precision and keeps unrepresentable input invalid instead of rounding', () => {
  render(<Field />);
  const field = screen.getByRole('textbox', { name: 'Every, seconds' });
  expect(field).toHaveValue('1');
  fireEvent.change(field, { target: { value: '1.001' } });
  expect(screen.getByLabelText('Stored milliseconds')).toHaveTextContent('1001');
  expect(field).toHaveValue('1.001');
  fireEvent.change(field, { target: { value: '1.0001' } });
  expect(screen.getByLabelText('Stored milliseconds')).toHaveTextContent('"1.0001"');
  fireEvent.change(field, { target: { value: '' } });
  expect(screen.getByLabelText('Stored milliseconds')).toHaveTextContent('""');
});
