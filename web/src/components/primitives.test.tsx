// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { useState } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { createQueryClient } from '../app/queries.js';
import { afterEach, expect, it, vi } from 'vitest';
import { Button } from './Button.js';
import { Dialog } from './Dialog.js';
import { Checkbox, Select, TextInput } from './Fields.js';
import { NotFound } from './NotFound.js';
import { Pagination, usePage } from './Pagination.js';
import { SegmentedFilter } from './SegmentedFilter.js';
import { Table, Td } from './Table.js';
import { Tabs } from './Tabs.js';

afterEach(cleanup);

it('keeps a loading button focusable, labelled with its -ing form, and blocks presses', () => {
  const press = vi.fn();
  const { rerender } = render(
    <Button variant="primary" loadingLabel="Starting" onClick={press}>
      Start run
    </Button>,
  );
  const button = screen.getByRole('button', { name: 'Start run' });
  fireEvent.click(button);
  expect(press).toHaveBeenCalledTimes(1);
  rerender(
    <Button variant="primary" loading loadingLabel="Starting" onClick={press}>
      Start run
    </Button>,
  );
  expect(button).toHaveAccessibleName('Starting');
  expect(button).toHaveAttribute('aria-busy', 'true');
  expect(button).not.toBeDisabled();
  fireEvent.click(button);
  expect(press).toHaveBeenCalledTimes(1);
});

it('links field errors and hints to the control', () => {
  render(
    <>
      <TextInput label="Path" hint="Starts with /" error="Path must start with /" defaultValue="checkout" />
      <Select label="Method" loading />
      <Checkbox label="Run alone" error="Pick one" />
    </>,
  );
  const path = screen.getByLabelText('Path');
  expect(path).toHaveAttribute('aria-invalid', 'true');
  expect(path).toHaveAccessibleDescription('Starts with / Path must start with /');
  expect(screen.getByLabelText('Method')).toBeDisabled();
  expect(screen.getByLabelText('Method')).toHaveAttribute('aria-busy', 'true');
  expect(screen.getByRole('checkbox', { name: 'Run alone' })).toHaveAccessibleDescription('Pick one');
});

function DialogHarness() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>Delete run</button>
      {open && (
        <Dialog
          title="Delete run 7e1a?"
          onClose={() => setOpen(false)}
          actions={
            <>
              <Button onClick={() => setOpen(false)}>Keep run</Button>
              <Button variant="danger">Delete run</Button>
            </>
          }
        />
      )}
    </>
  );
}

it('traps focus in a dialog, closes on Escape and returns focus to the invoker', () => {
  render(<DialogHarness />);
  const invoker = screen.getByRole('button', { name: 'Delete run' });
  invoker.focus();
  fireEvent.click(invoker);
  const dialog = screen.getByRole('dialog', { name: 'Delete run 7e1a?' });
  const keep = within(dialog).getByRole('button', { name: 'Keep run' });
  const confirm = within(dialog).getByRole('button', { name: 'Delete run' });
  expect(keep).toHaveFocus();
  confirm.focus();
  fireEvent.keyDown(confirm, { key: 'Tab' });
  expect(keep).toHaveFocus();
  fireEvent.keyDown(keep, { key: 'Tab', shiftKey: true });
  expect(confirm).toHaveFocus();
  fireEvent.keyDown(confirm, { key: 'Escape' });
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  expect(invoker).toHaveFocus();
});

it('moves tab and segment selection with arrows and skips disabled items', () => {
  const select = vi.fn();
  const change = vi.fn();
  render(
    <>
      <Tabs
        label="Sections"
        idBase="run"
        selected="summary"
        onSelect={select}
        items={[
          { id: 'summary', label: 'Summary' },
          { id: 'charts', label: 'Charts', disabled: true },
          { id: 'report', label: 'Report' },
        ]}
      />
      <SegmentedFilter
        label="State"
        value="all"
        onChange={change}
        options={[
          { value: 'all', label: 'All', count: 12 },
          { value: 'failed', label: 'Failed' },
        ]}
      />
    </>,
  );
  fireEvent.keyDown(screen.getByRole('tab', { name: 'Summary' }), { key: 'ArrowRight' });
  expect(select).toHaveBeenCalledWith('report');
  expect(screen.getByRole('radio', { name: 'All 12' })).toBeChecked();
  expect(screen.getByRole('radio', { name: 'Failed' })).not.toBeChecked();
  fireEvent.keyDown(screen.getByRole('radio', { name: 'All 12' }), { key: 'End' });
  expect(change).toHaveBeenCalledWith('failed');
});

it('right-aligns numeric cells and renders not-found copy with its back link', () => {
  render(
    <MemoryRouter>
      <Table caption="Endpoints" columns={[{ key: 'path', label: 'Endpoint' }, { key: 'p95', label: 'p95', numeric: true, sort: 'descending' }]}>
        <tr>
          <Td>/offers</Td>
          <Td numeric>323 ms</Td>
        </tr>
      </Table>
      <NotFound kind="run" back={{ to: '/runs', label: 'Back to runs' }} />
    </MemoryRouter>,
  );
  expect(screen.getByRole('columnheader', { name: /p95/ })).toHaveAttribute('aria-sort', 'descending');
  expect(screen.getByRole('cell', { name: '323 ms' })).toHaveClass('numeric');
  expect(screen.getByRole('heading', { name: "That run isn't here" })).toBeVisible();
  expect(screen.getByRole('link', { name: 'Back to runs' })).toHaveAttribute('href', '/runs');
});

function Pager({ order }: { order?: 'newest' | 'oldest' | undefined }) {
  const page = usePage(['pager-test']);
  return <Pagination page={page} next={`cursor-${page.position}`} order={order} />;
}
function mountPager(order?: 'newest' | 'oldest') {
  return render(
    <QueryClientProvider client={createQueryClient()}>
      <Pager order={order} />
    </QueryClientProvider>,
  );
}

it('labels time-ordered pages Newer/Older in list order and shows the page position', () => {
  mountPager('newest');
  const pages = screen.getByRole('navigation', { name: 'Pages' });
  expect(pages).toHaveTextContent('Page 1');
  expect(screen.getByRole('button', { name: 'Newer' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  fireEvent.click(screen.getByRole('button', { name: 'Older' }));
  expect(pages).toHaveTextContent('Page 3');
  fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
  expect(pages).toHaveTextContent('Page 2');
  cleanup();
  mountPager('oldest');
  expect(screen.getByRole('button', { name: 'Older' })).toBeDisabled();
  fireEvent.click(screen.getByRole('button', { name: 'Newer' }));
  expect(screen.getByRole('navigation', { name: 'Pages' })).toHaveTextContent('Page 2');
});

it('keeps Back/Next for identifier-ordered lists and stops at the retained history', () => {
  mountPager();
  for (let index = 0; index < 25; index++) fireEvent.click(screen.getByRole('button', { name: 'Next' }));
  expect(screen.getByRole('navigation', { name: 'Pages' })).toHaveTextContent('Page 26');
  for (let index = 0; index < 20; index++) fireEvent.click(screen.getByRole('button', { name: 'Back' }));
  expect(screen.getByRole('navigation', { name: 'Pages' })).toHaveTextContent('Page 6');
  expect(screen.getByRole('button', { name: 'Back' })).toBeDisabled();
});
