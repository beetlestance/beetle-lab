// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { ids, json, mount, org, readNamespace, testClient } from './test-fixtures.js';
import { orgScope, settings, workspaceScope } from '../features/settings/test-fixtures.js';

afterEach(cleanup);

const mainNav = () => within(screen.getByRole('navigation', { name: 'Main navigation' }));
const settingsNav = () => within(screen.getByRole('navigation', { name: 'Settings level' }));

function fixture() {
  return testClient((request) => {
    if (request.path.startsWith('/api/v2/organizations?'))
      return json({
        scope: { kind: 'installation' },
        items: [
          { ...org(), name: 'First org' },
          { ...org(ids.b), name: 'Second org' },
        ],
        nextCursor: null,
      });
    if (request.path.endsWith('/settings')) {
      const scope = request.path.includes('/workspaces/')
        ? workspaceScope
        : request.path.includes('/organizations/')
          ? orgScope
          : { kind: 'installation' as const };
      return json(settings(scope));
    }
    return readNamespace(request);
  });
}

it('opens the switcher, supports Escape and navigates to a selected organization', async () => {
  const { client, records } = fixture();
  mount(client);
  await screen.findByRole('link', { name: 'First org' });
  expect(records.some((record) => record.path.includes('limit=20'))).toBe(false);
  const trigger = screen.getByRole('button', { name: /switch organization/ });
  fireEvent.click(trigger);
  const dropdown = () => within(screen.getByRole('navigation', { name: 'Switch organization' }));
  const second = await dropdown().findByRole('link', { name: 'Second org' });
  second.focus();
  fireEvent.keyDown(second, { key: 'Escape' });
  expect(trigger).toHaveFocus();
  expect(trigger).toHaveAttribute('aria-expanded', 'false');
  fireEvent.click(trigger);
  fireEvent.click(await dropdown().findByRole('link', { name: 'Second org' }));
  expect(await screen.findByRole('link', { name: 'Same workspace' })).toHaveAttribute(
    'href',
    expect.stringContaining(ids.b),
  );
  expect(screen.queryByRole('navigation', { name: 'Switch organization' })).not.toBeInTheDocument();
});

it('keeps workspace settings inside the workspace and the levels above in Settings', async () => {
  mount(fixture().client);
  fireEvent.click(mainNav().getByRole('link', { name: 'Workspaces' }));
  expect(await screen.findByRole('heading', { name: 'Workspaces' })).toBeVisible();
  fireEvent.click(await screen.findByRole('link', { name: 'First org' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Same workspace' }));
  const sections = () => within(screen.getByRole('navigation', { name: 'Workspace sections' }));
  fireEvent.click(await screen.findByRole('link', { name: 'Suites' }));
  fireEvent.click(sections().getByRole('link', { name: 'Settings' }));
  await screen.findByRole('list', { name: 'Settings for Same workspace' });
  expect(screen.getByRole('heading', { level: 1, name: 'Same workspace' })).toBeVisible();
  expect(mainNav().getByRole('link', { name: 'Workspaces' })).toHaveAttribute('aria-current', 'page');
  expect(screen.queryByRole('navigation', { name: 'Settings level' })).not.toBeInTheDocument();
  fireEvent.click(mainNav().getByRole('link', { name: 'Settings' }));
  await screen.findByRole('navigation', { name: 'Settings level' });
  expect(settingsNav().getByRole('link', { name: 'Organization' })).toHaveAttribute('aria-current', 'page');
  fireEvent.click(settingsNav().getByRole('link', { name: 'Installation' }));
  await screen.findByRole('list', { name: 'Settings for installation' });
  expect(settingsNav().getAllByRole('link')).toHaveLength(2);
});

it('lets a user entering settings from installation choose an organization', async () => {
  mount(fixture().client);
  fireEvent.click(mainNav().getByRole('link', { name: 'Settings' }));
  await screen.findByRole('list', { name: 'Settings for installation' });
  fireEvent.click(settingsNav().getByRole('link', { name: 'Organization' }));
  await screen.findByRole('heading', { name: 'Choose an organization' });
  fireEvent.click(await screen.findByRole('link', { name: 'First org' }));
  await screen.findByRole('list', { name: /Settings for/ });
  expect(settingsNav().getByRole('link', { name: 'Organization' })).toHaveAttribute('aria-current', 'page');
});
