// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { ScriptSource } from './ScriptSource.js';

afterEach(cleanup);
it('bounds DOM and indexes the last line of a newline-dense script', () => {
  const text = '\n'.repeat(1_048_575) + 'last line';
  const { container } = render(<ScriptSource text={text} />);
  const source = screen.getByRole('region', { name: 'Script source' });
  expect(container.querySelectorAll('.script-source-line')).toHaveLength(34);
  expect(container.querySelectorAll('*').length).toBeLessThan(110);
  fireEvent.scroll(source, { target: { scrollTop: 21 * 1_048_575 } });
  expect(screen.getByText('last line')).toBeInTheDocument();
  expect(container.querySelector('.script-source-line')?.getAttribute('style')).toContain('7ch');
  expect(screen.getByText(/Copy script and Export script include the complete source/)).toBeInTheDocument();
});
it('shows exact short-script text with numbers hidden from assistive technology', () => {
  const { container } = render(<ScriptSource text={'one\ntwo\n'} />);
  expect(container.querySelectorAll('code')).toHaveLength(3);
  expect(container.querySelector('code')).toHaveTextContent('one');
  expect(container.querySelector('.script-line-number')).toHaveAttribute('aria-hidden', 'true');
  expect(screen.getByRole('region')).toHaveStyle({ height: '95px' });
});
