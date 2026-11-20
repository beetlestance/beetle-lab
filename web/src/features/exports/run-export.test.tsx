// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ExportJob } from '@beetle/contracts/api';
import type { RequestRecord } from '../../app/test-fixtures.js';
import { apiError } from '../../app/test-fixtures.js';
import { routes } from '../../app/routes.js';
import { run } from '../runs/test-fixtures.js';
import { RunExportAction } from './RunExport.js';
import { environment, exportJob, json, testClient } from './fixtures.js';

afterEach(cleanup);

const source = run();
const { organizationId, workspaceId } = source.scope;
const ready = {
  ...exportJob(),
  state: 'ready',
  artifact: { artifactId: source.id, bytes: 84_000, sha256: 'e'.repeat(64), name: 'suite.js', mediaType: 'text/javascript' },
} as ExportJob;

function mount(handler: (request: RequestRecord) => Response) {
  const api = testClient(handler);
  environment(api.client).mount(
    <MemoryRouter>
      <RunExportAction run={source} label="405b" />
    </MemoryRouter>,
  );
  return api;
}

it('asks the server to export the run, follows the job and offers the verified script', async () => {
  const api = mount((request) => {
    if (request.method === 'POST') return json(exportJob(), 202);
    return json(ready);
  });
  fireEvent.click(screen.getByRole('button', { name: 'Export script…' }));
  expect(await screen.findByRole('dialog', { name: 'Run 405b is ready as a k6 script' })).toBeInTheDocument();
  const post = api.records.find((record) => record.method === 'POST')!;
  expect(post.path).toBe(`/api/v2/organizations/${organizationId}/workspaces/${workspaceId}/runs/${source.id}/exports`);
  expect(post.body).toEqual({ scope: source.scope, requestId: expect.any(String) });
  expect(screen.getByRole('link', { name: 'Open Exports' })).toHaveAttribute(
    'href',
    routes.exports(organizationId, workspaceId),
  );
  fireEvent.click(screen.getByRole('button', { name: 'Close' }));
  fireEvent.click(screen.getByRole('button', { name: 'Export script…' }));
  await screen.findByRole('dialog', { name: 'Run 405b is ready as a k6 script' });
  expect(api.records.filter((record) => record.method === 'POST')).toHaveLength(1);
});

it('shows the refusal and starts a new request only when asked', async () => {
  const api = mount(() => json(apiError('invalid_value'), 422));
  fireEvent.click(screen.getByRole('button', { name: 'Export script…' }));
  expect(await screen.findByRole('dialog', { name: 'The export could not start' })).toBeInTheDocument();
  expect(screen.getByRole('alert')).toBeVisible();
  fireEvent.click(screen.getByRole('button', { name: 'Try again' }));
  await screen.findByRole('dialog', { name: 'The export could not start' });
  const posts = api.records.filter((record) => record.method === 'POST');
  expect(posts).toHaveLength(2);
  expect(posts[0]!.body).not.toEqual(posts[1]!.body);
});
