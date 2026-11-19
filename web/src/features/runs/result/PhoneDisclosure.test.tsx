// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PhoneDisclosure } from './PhoneDisclosure.js';
afterEach(() => { cleanup(); window.history.replaceState(null,'','/'); });
function mount(entry = '/') {
  return render(<MemoryRouter initialEntries={[entry]}><PhoneDisclosure id="target-details" hashId="result-target"
    title="Target runtime" description="Heap and CPU"><p>Recorded target data</p></PhoneDisclosure></MemoryRouter>);
}
it('does not mount a collapsed section body and opens/closes with native details', async () => {
  mount(); const details = screen.getByText('Target runtime').closest('details')!;
  expect(screen.queryByText('Recorded target data')).not.toBeInTheDocument();
  details.open = true; fireEvent(details,new Event('toggle'));
  expect(await screen.findByText('Recorded target data')).toBeVisible();
  details.open = false; fireEvent(details,new Event('toggle'));
  expect(screen.getByText('Recorded target data')).not.toBeVisible();
});
it('opens an initial inner-section hash and listens for native hash navigation', async () => {
  mount('/#result-target');
  expect(screen.getByText('Recorded target data')).toBeVisible();
  const details=screen.getByText('Target runtime').closest('details')!;
  details.open=false;fireEvent(details,new Event('toggle'));
  window.history.pushState(null,'','/#result-target');fireEvent(window,new Event('hashchange'));
  expect(await screen.findByText('Recorded target data')).toBeVisible();
});
it('retains form state through collapse and desktop/phone composition changes', async () => {
  const view = (expanded: boolean) => <MemoryRouter><PhoneDisclosure id="notes" title="Notes" description="One note"
    expanded={expanded}><input aria-label="Draft" defaultValue="Original" /></PhoneDisclosure></MemoryRouter>;
  const mounted=render(view(true));
  fireEvent.change(screen.getByLabelText('Draft'), { target: { value: 'Unsaved draft' } });
  mounted.rerender(view(false));
  const details=screen.getByText('Notes').closest('details')!;
  details.open=true;fireEvent(details,new Event('toggle'));
  expect(await screen.findByLabelText('Draft')).toHaveValue('Unsaved draft');
  details.open=false;fireEvent(details,new Event('toggle'));
  expect(screen.getByLabelText('Draft')).not.toBeVisible();
  mounted.rerender(view(true));
  expect(screen.getByLabelText('Draft')).toHaveValue('Unsaved draft');
});
