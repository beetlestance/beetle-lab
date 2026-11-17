// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { Folder, FolderPage, Suite, SuiteGroup, SuitePage, SuiteRevision, WorkspaceSettings } from '@beetle/contracts/api';
import { folder as baseFolder, ids, json, mount } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';
import { historyPage, receipt, run, runRead, settings as baseSettings, testClient } from '../runs/test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';

afterEach(cleanup);
const scope = { kind: 'workspace' as const, organizationId: ids.a, workspaceId: ids.workspace };
const suiteId = '33333333-3333-4333-8333-333333333333';
const revisionId = '22222222-2222-4222-8222-222222222222';
const runIdLatest = '44444444-4444-4444-8444-444444444444';
const today = new Date();
const suite: Suite = { id: suiteId, scope, version: 2, name: 'steady-1.2k', folderId: ids.folder, currentRevisionId: revisionId, description: 'Holds checkout traffic at the sale-day rate.' };
const capacity: Folder = { ...baseFolder(), name: 'capacity', displayPath: ['capacity'] };
const rootFolder: Folder = { ...baseFolder(), id: ids.root, name: 'root', parentFolderId: null, displayPath: [] };
const groups = { in_progress: 1, passed: 16, failed: 2, inconclusive: 0, stopped: 0, no_runs: 1 };
const latestRun = { suiteId, runId: runIdLatest, state: 'active' as const, outcome: 'pending' as const, requestedAt: today.toISOString() };
function folders(suiteCount = 20): FolderPage {
  return {
    scope,
    items: [rootFolder, capacity],
    nextCursor: null,
    summaries: [
      { folderId: ids.root, suiteCount: 0, subfolderCount: 1, groups: { ...groups, in_progress: 0, passed: 0, failed: 0, no_runs: 0 }, latestRun: null },
      { folderId: ids.folder, suiteCount, subfolderCount: 0, groups: suiteCount ? groups : { ...groups, in_progress: 0, passed: 0, failed: 0, no_runs: 0 }, latestRun: suiteCount ? latestRun : null },
    ],
  };
}
function suites(items: Suite[] = [suite], group: SuiteGroup = 'in_progress'): SuitePage {
  return { scope, items, nextCursor: null, summaries: items.map((item) => ({ suiteId: item.id, engineId: 'k6', group,
    latestRun: group === 'failed' ? { ...latestRun, state: 'finished' as const, outcome: 'failed' as const } : latestRun })) };
}
const config = {
  version: 1, target: 'http://checkout-api:8080', datasets: [], secrets: [],
  requests: [{ id: 'cart', name: 'Cart', method: 'POST', path: '/cart/items', query: {}, headers: {}, assertions: [{ id: 'a', required: true, kind: 'statusEq', value: 201 }] }],
  loadPlan: { version: 1, slos: [{ id: 'p95', metric: 'http_req_duration', stat: 'p95', operator: '<', value: 250 }], scenarios: [
    { id: 'main', name: 'main', executor: 'constant-arrival-rate', startTime: '0s', gracefulStop: '0s', rate: 1200, timeUnit: '1s', duration: '10m', preAllocatedVUs: 120, maxVUs: 240 }] },
  selections: [{ scenarioId: 'main', entries: [{ requestId: 'cart', weight: 1, wait: { durationMs: 0, jitterMs: 0 } }] }],
};
const revision: SuiteRevision = { id: revisionId, scope, suiteId, ordinal: 4, engineId: 'k6', configVersion: 1, digest: 'a'.repeat(64), preflightStatus: 'passed', config, inputManifest: [], savedAt: today.toISOString(), savedBy: 'Meera', message: 'Sale-day rate', runCount: 3 };
const summary = Object.fromEntries(Object.entries(revision).filter(([key]) => key !== 'config' && key !== 'inputManifest'));
function settings(): WorkspaceSettings {
  const base = baseSettings();
  const source = scope;
  const leaf = (value: number, maximum: number) => ({ value, source, allowedRange: { minimum: 1, maximum } });
  return { ...base, effective: { ...base.effective, runDefaults: { engineProfile: { value: 'k6', source, allowedValues: ['k6'] }, budget: {
    cpuMillis: leaf(2000, 8000), memoryBytes: leaf(4 * 1024 ** 3, 8 * 1024 ** 3), pids: leaf(512, 4096), timeoutMs: leaf(1_800_000, 3_600_000), outputBytes: leaf(2 * 1024 ** 3, 10 * 1024 ** 3) } } } };
}
function handler(overrides: (request: RequestRecord) => Response | undefined = () => undefined) {
  return (request: RequestRecord) => {
    const special = overrides(request);
    if (special) return special;
    const url = new URL(request.path, 'http://localhost');
    if (request.method === 'POST' && url.pathname.endsWith('/runs')) return json(receipt(request.body as never), 202);
    const route = routesTable.find(([suffix]) => url.pathname.endsWith(suffix));
    return route ? route[1](url) : runRead(request);
  };
}
const routesTable: [string, (url: URL) => Response][] = [
  ['/folders', () => json(folders())],
  ['/suites', (url) => json(suites([suite], (url.searchParams.get('group') as SuiteGroup | null) ?? 'in_progress'))],
  [`/suites/${suiteId}`, () => json(suite)],
  [`/suites/${suiteId}/revisions`, () => json({ scope, suiteId, items: [summary], nextCursor: null })],
  [`/revisions/${revisionId}`, () => json(revision)],
  ['/settings', () => json(settings())],
  ['/runs', () => json(historyPage([{ ...run(), id: runIdLatest, revisionId, state: 'finished', outcome: 'passed', validationStatus: 'passed' }]))],
];
const query = (record: RequestRecord) => new URL(record.path, 'http://localhost').searchParams;

describe('Suites board', () => {
  it('lists top-level folders with summary counts, mix and latest run, and totals a complete page', async () => {
    const fixture = testClient(handler());
    mount(fixture.client, routes.suites(ids.a, ids.workspace));
    const row = (await screen.findByRole('link', { name: 'capacity' })).closest('tr')!;
    expect(row).toHaveTextContent('16 passed, 2 failed, 1 in progress, 1 with no runs');
    expect(within(row).getByText('20')).toBeInTheDocument();
    expect(await within(row).findByText('steady-1.2k')).toBeInTheDocument();
    expect(within(row).getByRole('link', { name: 'Running, latest run in capacity' })).toHaveAttribute('href', routes.run(ids.a, ids.workspace, runIdLatest));
    expect(screen.getByText(/20 suites in 1 folder\./)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Workspace root' })).not.toBeInTheDocument();
    expect(row.querySelector('a')).toHaveAttribute('href', `${routes.suites(ids.a, ids.workspace)}?folder=${ids.folder}`);
  });
  it('searches every suite by name only after 3 characters and offers Clear search on no match', async () => {
    const fixture = testClient(handler((request) => (query(request).get('name') === 'zzz' ? json(suites([])) : undefined)));
    mount(fixture.client, routes.suites(ids.a, ids.workspace));
    const box = await screen.findByRole('searchbox', { name: 'Search every suite in Same workspace' });
    fireEvent.change(box, { target: { value: 'zz' } });
    expect(screen.getByText('Type at least 3 characters.')).toBeInTheDocument();
    fireEvent.change(box, { target: { value: 'zzz' } });
    await screen.findByText('Search looks at suite names only.');
    const searches = fixture.records.filter((record) => query(record).has('name'));
    expect(searches.map((record) => query(record).get('name'))).toEqual(['zzz']);
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }));
    expect(await screen.findByRole('link', { name: 'capacity' })).toBeInTheDocument();
  });
  it('shows the engine picker with k6 choosable and the other engines planned', async () => {
    mount(testClient(handler()).client, routes.suites(ids.a, ids.workspace));
    fireEvent.click(await screen.findByRole('button', { name: 'New suite' }));
    const dialog = screen.getByRole('dialog', { name: 'What should this suite run?' });
    expect(within(dialog).getAllByText('Planned')).toHaveLength(5);
    expect(within(dialog).getAllByRole('button')).toHaveLength(2);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Not now' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
describe('Suites / Folder board', () => {
  const folderPath = `${routes.suites(ids.a, ids.workspace)}?folder=${ids.folder}`;
  it('reads one folder server-side with group chips, row plan and revision, and filters by group', async () => {
    const fixture = testClient(handler());
    mount(fixture.client, folderPath);
    expect(await screen.findByRole('heading', { name: 'capacity', level: 1 })).toBeInTheDocument();
    const row = (await screen.findByRole('link', { name: 'steady-1.2k' })).closest('tr')!;
    expect(row).toHaveTextContent('Holds checkout traffic at the sale-day rate.');
    expect(row).toHaveTextContent('k6 load');
    expect(await within(row).findByText('Constant arrival rate')).toBeInTheDocument();
    expect(row).toHaveTextContent('10:00 total, 1 request');
    const list = fixture.records.find((record) => record.path.includes('/suites?'))!;
    expect(query(list).get('folderId')).toBe(ids.folder);
    expect(query(list).get('order')).toBe('recent_run');
    const chips = screen.getByRole('radiogroup', { name: 'Last run result' });
    expect(within(chips).getByRole('radio', { name: 'All 20' })).toBeChecked();
    expect(within(chips).queryByRole('radio', { name: /Stopped/ })).not.toBeInTheDocument();
    fireEvent.click(within(chips).getByRole('radio', { name: 'Failed 2' }));
    await waitFor(() => expect(fixture.records.some((record) => query(record).get('group') === 'failed')).toBe(true));
    expect(await screen.findByText(/Showing 1 of 2 suites/)).toBeInTheDocument();
  });
  it('shows the empty folder state without listing suites', async () => {
    const fixture = testClient(handler((request) => (request.path.includes('/folders?') ? json(folders(0)) : undefined)));
    mount(fixture.client, folderPath);
    expect(await screen.findByRole('heading', { name: 'No suites in capacity yet' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New suite in capacity' })).toBeInTheDocument();
    expect(fixture.records.some((record) => record.path.includes('/suites?'))).toBe(false);
  });
  it('reports a folder that is not in the workspace', async () => {
    mount(testClient(handler()).client, `${routes.suites(ids.a, ids.workspace)}?folder=${ids.parent}`);
    expect(await screen.findByText(/That folder isn't in this workspace/)).toBeInTheDocument();
  });
});
describe('Suite / Overview and Start run', () => {
  const suitePath = routes.suite(ids.a, ids.workspace, suiteId);
  it('shows description, saved-by line, revision count, plan, requests, thresholds and recent runs', async () => {
    mount(testClient(handler()).client, suitePath);
    expect(await screen.findByRole('heading', { name: 'steady-1.2k', level: 1 })).toBeInTheDocument();
    expect(await screen.findByText(/Holds checkout traffic at the sale-day rate\. Revision 4, saved Today, \d\d:\d\d, by Meera\./)).toBeInTheDocument();
    expect(await screen.findByRole('tab', { name: 'Revisions (1)' })).toBeInTheDocument();
    expect(await screen.findByRole('heading', { name: 'Constant arrival rate' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Requests against http://checkout-api:8080' })).toBeInTheDocument();
    expect(screen.getByText('status is 201')).toBeInTheDocument();
    expect(screen.getByText('p95 under 250 ms')).toBeInTheDocument();
    expect(await screen.findByRole('link', { name: `Passed run ${runIdLatest}` })).toHaveTextContent('rev 4,');
  });
  it('starts a run alone with a budget changed for this run only', async () => {
    const fixture = testClient(handler());
    mount(fixture.client, suitePath);
    fireEvent.click(await screen.findByRole('button', { name: 'Start run' }));
    const dialog = await screen.findByRole('dialog', { name: 'Start steady-1.2k' });
    expect(await within(dialog).findByText('10:00. Within the 30-minute limit.')).toBeInTheDocument();
    expect(within(dialog).getByText(/2 CPUs, 4 GiB, 512 processes, 2 GiB output, from Same workspace\./)).toBeInTheDocument();
    expect(within(dialog).getByRole('combobox', { name: 'Revision' })).toHaveDisplayValue('Revision 4: Sale-day rate (latest)');
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Run alone. Other runs wait until this one ends.' }));
    fireEvent.click(within(dialog).getByRole('button', { name: 'Change for this run' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Memory, up to 8 GiB' }), { target: { value: '6' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start run' }));
    await waitFor(() => expect(fixture.records.some((record) => record.method === 'POST')).toBe(true));
    const body = fixture.records.find((record) => record.method === 'POST')!.body;
    expect(body).toMatchObject({ revisionId, engineProfile: 'k6', executionPolicy: { mode: 'isolated', preferIdle: false },
      budget: { cpuMillis: 2000, memoryBytes: 6 * 1024 ** 3, pids: 512, timeoutMs: 1_800_000, outputBytes: 2 * 1024 ** 3 } });
  });
  it('rejects a budget outside the allowed range before transport', async () => {
    const fixture = testClient(handler());
    mount(fixture.client, `${suitePath}?start=1`);
    const dialog = await screen.findByRole('dialog', { name: 'Start steady-1.2k' });
    fireEvent.click(await within(dialog).findByRole('button', { name: 'Change for this run' }));
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'CPUs, up to 8' }), { target: { value: '9' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Start run' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Check CPU');
    expect(fixture.records.some((record) => record.method === 'POST')).toBe(false);
  });
});
