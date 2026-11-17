// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreateExportRequest, ExportJob, SuiteRevision } from '@beetle/contracts/api';
import { exportContentPath } from '@beetle/contracts/api';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { ExportDialog } from './ExportDialog.js';
import { WorkspaceExports } from './ExportsTable.js';
import { environment, exportJob, exportSettings, json, revision, testClient } from './fixtures.js';
import { useRevisionExport } from './useRevisionExport.js';

afterEach(cleanup);

const rev = revision();
const { organizationId, workspaceId } = rev.scope;
const artifact = { artifactId: rev.id, bytes: 84_000, sha256: 'e'.repeat(64), name: 'suite.js', mediaType: 'text/javascript' };

function Harness({ value }: { value: SuiteRevision }) {
  const flow = useRevisionExport(value);
  return <ExportDialog revision={value} suiteName="Checkout" flow={flow} close={() => undefined} editHref="/edit" />;
}
function mount(value: SuiteRevision, handler: (request: RequestRecord) => Response) {
  const api = testClient(handler);
  environment(api.client).mount(
    <MemoryRouter>
      <Harness value={value} />
    </MemoryRouter>,
  );
  return api;
}
function listing(jobs: readonly ExportJob[]) {
  return (request: RequestRecord) => {
    if (request.path.includes('/exports?')) return json({ scope: rev.scope, items: jobs, nextCursor: null });
    const job = jobs.find((item) => request.path.endsWith(`/exports/${item.id}`));
    if (job) return json(job);
    throw new Error(`Unexpected synthetic route ${request.path}`);
  };
}

it('explains that revisions with secrets are never exported and sends nothing', async () => {
  const value = { ...rev, config: { ...rev.config, secrets: [{ name: 'API_TOKEN', provider: 'env', locator: 'TOKEN' }] } };
  const api = mount(value, listing([]));
  expect(await screen.findByRole('dialog', { name: 'This revision can’t be exported' })).toBeInTheDocument();
  expect(screen.getByText(/uses the secret API_TOKEN/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Open the editor' })).toHaveAttribute('href', '/edit');
  expect(api.records.every((record) => record.method === 'GET')).toBe(true);
});

it('prepares a script with the default options and then shows its progress', async () => {
  let accepted: ExportJob | undefined;
  const api = mount(rev, (request) => {
    if (request.method === 'POST') {
      accepted = exportJob(request.body as unknown as CreateExportRequest);
      return json(accepted, 202);
    }
    if (request.path.endsWith('/exports/profiles')) return json({ scope: rev.scope, profiles: ['k6'] });
    if (request.path.includes('/settings')) return json(exportSettings());
    return listing(accepted ? [accepted] : [])(request);
  });
  fireEvent.click(await screen.findByRole('button', { name: 'Prepare script' }));
  expect(await screen.findByRole('dialog', { name: 'Preparing a k6 script from revision 2' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'Cancel export' })).toBeEnabled();
  const current = within(screen.getByRole('list')).getByText(', in progress');
  expect(current.parentElement).toHaveTextContent('Queued');
  const posts = api.records.filter((record) => record.method === 'POST');
  expect(posts).toHaveLength(1);
  expect(posts[0]!.path).toContain(`/revisions/${rev.id}/exports`);
  expect(posts[0]!.body).toMatchObject({ revisionId: rev.id, options: { maximumBuildBytes: 1048576, scriptTimeoutMs: 180000 } });
});

it('offers the ready script with its size, SHA-256 and scoped download', async () => {
  const job = { ...exportJob(), state: 'ready', artifact } as ExportJob;
  mount(rev, listing([job]));
  expect(await screen.findByRole('dialog', { name: 'Checkout, revision 2 is ready as a k6 script' })).toBeInTheDocument();
  expect(screen.getByText('84 KB')).toBeInTheDocument();
  expect(screen.getByText('e'.repeat(64))).toBeInTheDocument();
  const link = screen.getByRole('link', { name: 'Download script' });
  expect(link).toHaveAttribute('href', exportContentPath({ organizationId, workspaceId, exportId: job.id }));
  expect(link).toHaveAttribute('download', 'suite.js');
});

it('never guesses the outcome of an unknown export', async () => {
  mount(rev, listing([{ ...exportJob(), state: 'unknown', reason: 'delivery_unknown' } as ExportJob]));
  expect(await screen.findByRole('dialog', { name: 'We can’t tell whether this export finished' })).toBeInTheDocument();
  expect(screen.getByText(/of output/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Cancel export' })).toBeEnabled();
  expect(screen.queryByRole('link', { name: 'Download script' })).toBeNull();
});

it('lists workspace exports with a download for ready rows and cancel for live ones', async () => {
  const ready = { ...exportJob(), state: 'ready', artifact } as ExportJob;
  const live = { ...exportJob(), id: '55555555-5555-4555-8555-555555555555', state: 'generating' } as ExportJob;
  const suite = { id: rev.suiteId, scope: rev.scope, name: 'Checkout', version: 1, folderId: rev.id, currentRevisionId: rev.id };
  const api = testClient((request) => {
    if (request.path.includes('/suites?')) return json({ scope: rev.scope, items: [suite], nextCursor: null });
    if (request.path.endsWith(`/revisions/${rev.id}`)) return json(rev);
    return listing([ready, live])(request);
  });
  environment(api.client).mount(
    <MemoryRouter>
      <WorkspaceExports organizationId={organizationId} workspaceId={workspaceId} />
    </MemoryRouter>,
  );
  const table = await screen.findByRole('table', { name: 'Script exports' });
  expect((await within(table).findAllByText('Checkout · revision 2')).length).toBe(2);
  expect(within(table).getByRole('link', { name: 'Download' })).toHaveAttribute('download', 'suite.js');
  expect(within(table).getByRole('button', { name: 'Cancel' })).toBeEnabled();
  expect(within(table).getByText('Building the script')).toBeInTheDocument();
});
