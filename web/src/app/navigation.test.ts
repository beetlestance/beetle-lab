import { expect, it } from 'vitest';
import { navItems, shellScope } from './navigation.js';
import { routes } from './routes.js';

const org = '11111111-1111-4111-8111-111111111111';
const ws = '22222222-2222-4222-8222-222222222222';
const run = '33333333-3333-4333-8333-333333333333';

function current(pathname: string) {
  return navItems(pathname)
    .filter((item) => item.current)
    .map((item) => item.key);
}

it('scopes navigation targets to the organisation and workspace in the path', () => {
  expect(shellScope(routes.run(org, ws, run))).toEqual({ organizationId: org, workspaceId: ws });
  expect(shellScope('/organizations/not-a-uuid')).toEqual({});
  const items = navItems(routes.runs(org, ws));
  expect(items.map((item) => [item.label, item.to])).toEqual([
    ['Overview', routes.workspace(org, ws)],
    ['Workspaces', routes.organization(org)],
    ['Engines', routes.engines],
    ['Settings', routes.workspaceSettings(org, ws)],
    ['Docs', routes.reference],
  ]);
});

it('marks exactly one current item per destination', () => {
  expect(current('/')).toEqual(['overview']);
  expect(current(routes.workspace(org, ws))).toEqual(['overview']);
  expect(current(routes.run(org, ws, run))).toEqual(['workspaces']);
  expect(current(routes.inputs(org, ws))).toEqual(['workspaces']);
  expect(current(routes.workspaceSettings(org, ws))).toEqual(['settings']);
  expect(current(routes.settings)).toEqual(['settings']);
  expect(current(routes.engines)).toEqual(['engines']);
  expect(current(routes.reference)).toEqual(['docs']);
  expect(current('/unknown')).toEqual([]);
});
