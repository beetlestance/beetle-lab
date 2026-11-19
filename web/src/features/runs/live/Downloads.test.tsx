// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { LiveDownloads } from './Downloads.js';
afterEach(cleanup);
it('dismisses on Escape/outside press and closes before handing off script selection', () => {
  const select = vi.fn();
  render(<LiveDownloads ordinal={4} snapshot={null} onScript={select} />);
  const button = screen.getByRole('button', { name: 'Download' });
  const details = button.closest('details')!;
  fireEvent.click(button);
  expect(details.open).toBe(true);
  fireEvent.keyDown(button, { key: 'Escape' });
  expect(details.open).toBe(false);
  expect(button).toHaveFocus();
  fireEvent.click(button);
  fireEvent.pointerDown(document.body);
  expect(details.open).toBe(false);
  fireEvent.click(button);
  fireEvent.click(screen.getByRole('button', { name: 'Script for revision 4' }));
  expect(details.open).toBe(false);
  expect(select).toHaveBeenCalledTimes(1);
});
