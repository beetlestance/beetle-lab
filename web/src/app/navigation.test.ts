import { expect, it } from 'vitest';
import { badgeScope, navItems, shellScope } from './navigation.js';
import { readSuitePage, routes } from './routes.js';

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
    ['Workspaces', routes.suites(org, ws)],
    ['Engines', routes.engines],
    ['Settings', routes.workspaceSettings(org, ws)],
    ['Docs', routes.docs],
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

it('builds suite page URLs that keep the existing tab scheme and read back with defaults', () => {
  const suite = '44444444-4444-4444-8444-444444444444';
  expect(routes.suitePage(org, ws, suite)).toBe(routes.suite(org, ws, suite));
  expect(routes.suitePage(org, ws, suite, { tab: 'edit' })).toBe(`${routes.suite(org, ws, suite)}?tab=edit`);
  expect(routes.suitePage(org, ws, suite, { tab: 'edit', view: 'run-setup' })).toBe(
    `${routes.suite(org, ws, suite)}?tab=edit&view=run-setup`,
  );
  expect(routes.suitePage(org, ws, suite, { tab: 'edit', view: 'form', request: 'get' })).toBe(
    `${routes.suite(org, ws, suite)}?tab=edit&request=get`,
  );
  expect(routes.suitePage(org, ws, suite, { start: true })).toBe(`${routes.suite(org, ws, suite)}?start=1`);
  expect(readSuitePage(new URLSearchParams('tab=edit'))).toEqual({ tab: 'edit', view: 'form', request: null, start: false });
  expect(readSuitePage(new URLSearchParams('tab=bogus&view=json&request=get'))).toEqual({
    tab: 'overview',
    view: 'json',
    request: null,
    start: false,
  });
  expect(routes.suitesFolder(org, ws, run)).toBe(`${routes.suites(org, ws)}?folder=${run}`);
  expect(routes.pinnedRuns(org, ws)).toBe(`${routes.runs(org, ws)}?pinned=true`);
});

it('permits badge reads only after the whole scoped route and every UUID are valid', () => {
  expect(badgeScope(routes.run(org, ws, run))).toEqual({ organizationId: org, workspaceId: ws });
  expect(badgeScope(routes.organization(org))).toEqual({ organizationId: org });
  for (const path of [routes.reference, `/organizations/${org}/workspaces/invalid`,
    `/organizations/${org}/workspaces/${ws}/runs/invalid`, `/organizations/${org}/unknown`]) {
    expect(badgeScope(path)).toEqual({});
  }
});
