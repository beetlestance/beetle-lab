// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, expect, it } from 'vitest';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { CreateExportRequest, ExportJob } from '@beetle/contracts/api';
import { SessionContext } from '../../app/session.js';
import { exportRequest, scriptLimitText } from './prepare.js';
import { ExportDialog } from './ExportDialog.js';
import { ExportForm } from './Form.js';
import { useRevisionExport } from './useRevisionExport.js';
import { environment, exportJob, exportSettings, json, revision, testClient } from './fixtures.js';

afterEach(cleanup);
const rev = revision();
function settings(timeoutMs = 600000) {
  const value = exportSettings();
  value.effective.runDefaults.budget.timeoutMs = {
    ...value.effective.runDefaults.budget.timeoutMs,
    value: timeoutMs,
    allowedRange: { minimum: 1, maximum: Number.MAX_SAFE_INTEGER },
  };
  return value;
}
function Harness() {
  const flow = useRevisionExport(rev);
  return <ExportDialog revision={rev} suiteName="Checkout" flow={flow} close={() => undefined} editHref="/edit" />;
}
function readyJob(): ExportJob {
  return { ...exportJob(), state: 'ready', artifact: {
    artifactId: rev.id, bytes: 10, sha256: 'e'.repeat(64), name: 'suite.js', mediaType: 'text/javascript',
  } } as ExportJob;
}

it('inherits the captured workspace timeout, rejects over 48 hours without clamping and renders exact small limits', () => {
  expect(exportRequest(rev, settings(), ['k6'], crypto.randomUUID()).options.scriptTimeoutMs).toBe(600000);
  expect(exportRequest(rev, settings(172800000), ['k6'], crypto.randomUUID()).options.scriptTimeoutMs).toBe(172800000);
  expect(() => exportRequest(rev, settings(172800001), ['k6'], crypto.randomUUID())).toThrow('at most 48 hours');
  expect([1, 100, 1000, 60000, 180000].map(scriptLimitText)).toEqual(['1 ms', '100 ms', '1 s', '1 min', '3 min']);
});

it('preserves an older ready script limit while preparing again, and replays the captured new budget after an unknown reply', async () => {
  const old = readyJob();
  let calls = 0;
  let timeout = 600000;
  let accepted: ExportJob | undefined;
  const api = testClient(request => {
    if (request.method === 'POST') {
      calls++;
      if (calls === 1) throw Error('Lost acceptance');
      accepted = { ...exportJob(request.body as unknown as CreateExportRequest), id: '55555555-5555-4555-8555-555555555555' };
      return json(accepted, 202);
    }
    if (request.path.includes('/settings')) return json(settings(timeout));
    if (request.path.endsWith('/exports/profiles')) return json({ scope: rev.scope, profiles: ['k6'] });
    if (request.path.endsWith('/exports/latest')) return json({ scope: rev.scope, revisionId: rev.id, job: old });
    return json(accepted ?? old);
  });
  environment(api.client).mount(<MemoryRouter><Harness /></MemoryRouter>);
  expect(await screen.findByText('3 min')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Prepare again' }));
  await screen.findByRole('button', { name: 'Replay export request' });
  expect(screen.getByRole('button', { name: 'Prepare again' })).toBeDisabled();
  expect(screen.getByText('3 min')).toBeInTheDocument();
  timeout = 900000;
  fireEvent.click(screen.getByRole('button', { name: 'Replay export request' }));
  await screen.findByRole('dialog', { name: 'Preparing a k6 script from revision 2' });
  const writes = api.records.filter(record => record.method === 'POST');
  expect(writes).toHaveLength(2);
  expect(writes[0]!.body).toEqual(writes[1]!.body);
  expect(writes[0]!.body).toMatchObject({ options: { scriptTimeoutMs: 600000 } });
});

it('keeps restored history downloads available while refusing new preparations', async () => {
  const old = readyJob();
  const api = testClient(request => json(request.path.endsWith('/exports/latest')
    ? { scope: rev.scope, revisionId: rev.id, job: old } : old));
  environment(api.client).mount(<SessionContext.Provider value={{ readOnly: true, restoredBackup: null }}>
    <MemoryRouter><Harness /></MemoryRouter>
  </SessionContext.Provider>);
  expect(await screen.findByRole('button', { name: 'Prepare again' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Download script' })).toBeEnabled();
  expect(api.records.every(request => request.method === 'GET')).toBe(true);
});

it('initialises the explicit form from workspace settings and preserves an entered override', async () => {
  const api = testClient(request => json(exportJob(request.body as unknown as CreateExportRequest), 202));
  environment(api.client).mount(<ExportForm revision={rev} settings={settings()} profiles={['k6']} created={() => undefined} />);
  const input = screen.getByLabelText('Generated script timeout (milliseconds)');
  expect(input).toHaveValue('600000');
  fireEvent.change(input, { target: { value: '900000' } });
  fireEvent.click(screen.getByRole('button', { name: 'Generate standalone script' }));
  await waitFor(() => expect(api.records).toHaveLength(1));
  expect(api.records[0]!.body).toMatchObject({ options: { scriptTimeoutMs: 900000 } });
});
