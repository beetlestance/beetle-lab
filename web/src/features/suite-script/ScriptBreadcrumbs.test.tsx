// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { MemoryRouter } from 'react-router-dom';
import type { Suite } from '@beetle/contracts/api';
import { environment, json, revision, testClient } from '../exports/fixtures.js';
import { workspace } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';
import { ScriptBreadcrumbs } from './ScriptBreadcrumbs.js';
import baseRun from '../../../../contracts/fixtures/api/valid/run.json' with { type: 'json' };
const rev = revision();
const suite: Suite = {
  id: rev.suiteId,
  scope: rev.scope,
  name: 'Checkout',
  version: 1,
  folderId: rev.id,
  currentRevisionId: rev.id,
};
const run = { ...baseRun, scope: rev.scope, suiteId: suite.id, revisionId: rev.id };
afterEach(cleanup);
function mount(search: string, value = run) {
  const api = testClient(() => json(value));
  environment(api.client).mount(
    <MemoryRouter initialEntries={[`/script${search}`]}>
      <ScriptBreadcrumbs suite={suite} revision={rev} workspace={workspace(rev.scope.organizationId)} choices={[]} />
    </MemoryRouter>,
  );
  return api;
}
it('reads exact run provenance and links back to it without deriving names from URL text', async () => {
  const api = mount(`?run=${run.id}&name=forged`);
  const link = await screen.findByRole('link', { name: /Run .*Checkout/ });
  expect(link).toHaveAttribute('href', routes.run(rev.scope.organizationId, rev.scope.workspaceId, run.id));
  expect(link).toHaveTextContent('script revision 2, latest is 2');
  expect(link).not.toHaveTextContent('forged');
  expect(api.records).toHaveLength(1);
});
it('rejects malformed or duplicate run context without issuing a read', () => {
  const api = mount(`?run=${run.id}&run=${run.id}`);
  expect(screen.getByText('Run context is invalid.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Use suite context' })).toHaveAttribute(
    'href',
    routes.suiteScript(rev.scope.organizationId, rev.scope.workspaceId, suite.id, rev.id),
  );
  expect(api.records).toHaveLength(0);
});
it('refuses to label a run from another suite as this script origin', async () => {
  mount(`?run=${run.id}`, { ...run, suiteId: '99999999-9999-4999-8999-999999999999' });
  expect(await screen.findByText('Run context is invalid.')).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Run .*Checkout/ })).toBeNull();
});
it('keeps the selected script revision distinct from an origin run using another revision', async () => {
  mount(`?run=${run.id}`, { ...run, revisionId: '99999999-9999-4999-8999-999999999999' });
  expect(await screen.findByRole('link', { name: /Run .*script revision 2/ })).toBeInTheDocument();
});
