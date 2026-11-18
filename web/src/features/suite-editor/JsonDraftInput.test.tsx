// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { JsonDraftInput } from './JsonDraftInput.js';

afterEach(cleanup);

describe('native JSON draft presentation', () => {
  it('accents template lines without replacing the editable text or duplicating accessibility content', () => {
    const change = vi.fn();
    const value = '{\n  "id": "{{data.users.id}}",\n  "text": "<script>"\n}';
    const { container } = render(<JsonDraftInput aria-label="Body" value={value} accentTemplates onChange={change} />);
    const input = screen.getByRole('textbox', { name: 'Body' }) as HTMLTextAreaElement;
    expect(input.value).toBe(value);
    expect(container.querySelectorAll('.json-template-line')).toHaveLength(1);
    expect(container.querySelector('pre')?.getAttribute('aria-hidden')).toBe('true');
    expect(container.querySelector('script')).toBeNull();
    input.setSelectionRange(3, 5);
    expect(input.selectionStart).toBe(3);
    fireEvent.change(input, { target: { value: '{}' } });
    expect(change).toHaveBeenCalledOnce();
  });

  it('bounds highlighted nodes and keeps all source editable when falling back', () => {
    const value = '{{x}}\n'.repeat(4097);
    const { container } = render(<JsonDraftInput aria-label="Large body" value={value} accentTemplates readOnly />);
    expect(container.querySelector('pre')).toBeNull();
    expect((screen.getByRole('textbox') as HTMLTextAreaElement).value).toBe(value);
  });

  it('synchronizes both scroll axes and renders plain JSON without the accent layer', () => {
    const { container, rerender } = render(<JsonDraftInput aria-label="Body" value="{{x}}" accentTemplates />);
    const input = screen.getByRole('textbox');
    fireEvent.scroll(input, { target: { scrollTop: 42, scrollLeft: 65 } });
    expect(container.querySelector('pre')?.scrollTop).toBe(42);
    expect(container.querySelector('pre')?.scrollLeft).toBe(65);
    rerender(<JsonDraftInput aria-label="Body" value="{}" />);
    expect(container.querySelector('pre')).toBeNull();
  });
});
