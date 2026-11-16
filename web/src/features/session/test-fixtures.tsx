import { render, fireEvent, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { BrowserSession } from '@beetle/contracts/api';
import { SessionApp } from './index.js';
import { apiError, json, readNamespace } from '../../app/test-fixtures.js';
import type { RequestRecord } from '../../app/test-fixtures.js';

export { apiError, deferred, json, org } from '../../app/test-fixtures.js';
export const token = 'synthetic_startup_token_'.padEnd(43, 'x');
export const session: BrowserSession = { scope: 'local-admin', expiresAt: '2027-01-01T00:00:00.000Z', csrfToken: 'c'.repeat(43) };
export const unpaired = () => json(apiError('unpaired'), 401);
export interface Record extends RequestRecord { headers: Headers; credentials: RequestCredentials | undefined }
/** Paired-profile fixture by default; automatic-profile cases opt in explicitly. */
export function browser(handler: (record: Record) => Response | Promise<Response>, initial = '/', autoOpen = false) {
  const records: Record[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    const record: Record = { path: url.pathname + url.search, method: init?.method ?? 'GET',
      body: typeof init?.body === 'string' ? JSON.parse(init.body) as RecordBody : undefined,
      signal: init?.signal ?? undefined, headers: new Headers(init?.headers), credentials: init?.credentials };
    records.push(record);
    if (records.length > 100) throw new Error('Synthetic request budget exceeded');
    return handler(record);
  };
  return { records, ...render(<MemoryRouter initialEntries={[initial]}><SessionApp baseUrl="http://localhost" fetch={fetcher} autoOpen={autoOpen} /></MemoryRouter>) };
}
type RecordBody = { [key: string]: unknown };
export function namespace(record: RequestRecord) { return readNamespace(record); }
export async function pair() {
  fireEvent.change(await screen.findByLabelText('Startup token'), { target: { value: token } });
  fireEvent.click(screen.getByRole('button', { name: 'Pair browser' }));
}
export const calls = (records: Record[], suffix: string) => records.filter(record => record.path.endsWith(suffix));
