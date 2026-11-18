// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExportJob, Suite, SuiteRevision } from '@beetle/contracts/api';
import { exportContentPath } from '@beetle/contracts/api';
import { environment, exportJob, json, revision, testClient } from '../exports/fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { apiError, workspace } from '../../app/test-fixtures.js';
import { SuiteScript } from './index.js';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const current = revision();
const { organizationId, workspaceId } = current.scope;
const earlierId = '44444444-4444-4444-8444-444444444444';
const script =
  "import http from 'k6/http';\nexport default function () {\n  http.get('http://synthetic.invalid');\n}\n";
const bytes = new TextEncoder().encode(script);

/** A body whose chunk is this realm's Uint8Array, as a browser stream yields. */
function scriptResponse() {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
  return new Response(body, { status: 200 });
}
async function sha256(value: Uint8Array) {
  const digest = await crypto.subtle.digest('SHA-256', Uint8Array.from(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
function suite(): Suite {
  return {
    id: current.suiteId,
    scope: current.scope,
    name: 'Checkout',
    version: 1,
    folderId: current.id,
    currentRevisionId: current.id,
  };
}
function revisions(): { second: SuiteRevision; first: SuiteRevision } {
  const second = {
    ...current,
    message: 'Lower the rate',
    savedBy: 'Meera',
    runCount: 2,
    config: { target: 'http://synthetic.invalid', requests: [{ id: 'home' }, { id: 'search' }] },
  };
  const first = {
    ...current,
    id: earlierId,
    ordinal: 1,
    config: { target: 'http://synthetic.invalid', requests: [{ id: 'home' }] },
  };
  return { second, first };
}
function summary(value: SuiteRevision) {
  const { id, scope, suiteId, ordinal, engineId, configVersion, digest, preflightStatus } = value;
  return {
    id,
    scope,
    suiteId,
    ordinal,
    engineId,
    configVersion,
    digest,
    preflightStatus,
    previousRevisionId: ordinal === 1 ? null : earlierId,
  };
}
function routes(job: ExportJob | null, overrides: Partial<Record<'revision', SuiteRevision>> = {}) {
  const { second, first } = revisions();
  const page = {
    scope: current.scope,
    suiteId: current.suiteId,
    items: [summary(second), summary(first)],
    nextCursor: null,
  };
  const table: [(path: string) => boolean, unknown][] = [
    [(path) => path.endsWith(`/suites/${current.suiteId}`), suite()],
    [(path) => path.includes(`/suites/${current.suiteId}/revisions?`), page],
    [(path) => path.endsWith(`/revisions/${current.id}`), overrides.revision ?? second],
    [(path) => path.endsWith(`/revisions/${earlierId}`), first],
    [(path) => path.endsWith('/exports/latest'), { scope: current.scope, revisionId: current.id, job }],
    [(path) => !!job && path.endsWith(`/exports/${job.id}`), job],
    [(path) => path.endsWith(`/workspaces/${workspaceId}`), workspace(organizationId)],
  ];
  return (request: RequestRecord) => {
    const match = table.find(([test]) => test(request.path));
    if (!match) throw new Error(`Unexpected synthetic route ${request.path}`);
    return json(match[1]);
  };
}
function mount(handler: (request: RequestRecord) => Response) {
  const api = testClient(handler);
  environment(api.client).mount(
    <MemoryRouter>
      <SuiteScript
        organizationId={organizationId}
        workspaceId={workspaceId}
        suiteId={current.suiteId}
        revisionId={current.id}
      />
    </MemoryRouter>,
  );
  return api;
}
async function readyJob(): Promise<ExportJob> {
  const artifact = {
    artifactId: current.id,
    bytes: bytes.byteLength,
    sha256: await sha256(bytes),
    name: 'suite.js',
    mediaType: 'text/javascript',
  };
  return { ...exportJob(), state: 'ready', artifact } as ExportJob;
}

it('shows not found when the revision belongs to another suite', async () => {
  mount(routes(null, { revision: { ...current, suiteId: earlierId } }));
  expect(await screen.findByText("That script isn't here")).toBeInTheDocument();
});

it('renders the header and offers to prepare a script when none exists', async () => {
  mount(routes(null));
  expect(await screen.findByRole('heading', { name: 'Script for revision 2' })).toBeInTheDocument();
  expect(screen.getByText('Lower the rate')).toBeInTheDocument();
  expect(screen.getByText('Saved by Meera; 2 runs used it.')).toBeInTheDocument();
  expect(await screen.findByText('This revision has no script yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Copy script' })).toBeDisabled();
  expect(await screen.findAllByRole('button', { name: 'Run this revision' })).toHaveLength(1);
});

it('runs this revision through the suite Start run dialog without sending anything until confirmed', async () => {
  const api = mount(routes(null));
  fireEvent.click(await screen.findByRole('button', { name: 'Run this revision' }));
  expect(await screen.findByRole('dialog', { name: 'Start Checkout' })).toBeInTheDocument();
  expect(api.records.every((record) => record.method === 'GET')).toBe(true);
});

it('reads the ready script once through the content route and checks its SHA-256', async () => {
  const job = await readyJob();
  const fetcher = vi.fn(async () => scriptResponse());
  vi.stubGlobal('fetch', fetcher);
  mount(routes(job));
  const source = await screen.findByRole('region', { name: 'Script source' });
  expect(within(source).getByText("import http from 'k6/http';")).toBeInTheDocument();
  expect(screen.getByText(/k6 run suite.js/)).toBeInTheDocument();
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher.mock.calls[0]).toEqual([
    exportContentPath({ organizationId, workspaceId, exportId: job.id }),
    expect.objectContaining({ method: 'GET' }),
  ]);
  expect(screen.getByRole('button', { name: 'Copy script' })).toBeEnabled();
});

it('refuses a script whose bytes do not match the published SHA-256', async () => {
  const job = {
    ...(await readyJob()),
    artifact: { ...(await readyJob()).artifact!, sha256: 'f'.repeat(64) },
  } as ExportJob;
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => scriptResponse()),
  );
  mount(routes(job));
  expect(await screen.findByText('The script did not match its SHA-256.')).toBeInTheDocument();
  expect(screen.queryByRole('region', { name: 'Script source' })).toBeNull();
});

it('diffs the saved configurations side by side and in one column', async () => {
  mount(routes(null));
  fireEvent.click(await screen.findByRole('tab', { name: /Changes/ }));
  expect((await screen.findAllByText(/Revision 1 → revision 2/)).length).toBeGreaterThan(0);
  expect(screen.getByText('1 request added')).toBeInTheDocument();
  expect(
    screen.getByText('Lines are from the saved configuration JSON, not the generated script.'),
  ).toBeInTheDocument();
  expect(screen.getByRole('radio', { name: 'Side by side' })).toBeChecked();
  fireEvent.click(screen.getByRole('radio', { name: 'One column' }));
  await waitFor(() => expect(screen.getByRole('radio', { name: 'One column' })).toBeChecked());
  expect(screen.getAllByLabelText('added').length).toBeGreaterThan(0);
});

it('shows a retryable export read failure rather than claiming the revision has no script', async () => {
  let unavailable = true;
  const normal = routes(null);
  mount((request) =>
    unavailable && request.path.endsWith('/exports/latest')
      ? json(apiError('storage_unavailable'), 503)
      : normal(request),
  );
  expect(await screen.findByText('Could not read this revision’s exports.')).toBeInTheDocument();
  expect(screen.queryByText('This revision has no script yet')).not.toBeInTheDocument();
  unavailable = false;
  fireEvent.click(screen.getByRole('button', { name: 'Retry exports' }));
  expect(await screen.findByText('This revision has no script yet')).toBeInTheDocument();
});
