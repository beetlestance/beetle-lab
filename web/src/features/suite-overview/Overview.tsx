import { useMemo } from 'react';
import type { ReactNode } from 'react';
import { useQueries } from '@tanstack/react-query';
import type { SuiteRevision } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { Badge } from '../../components/Badge.js';
import { Table, Td } from '../../components/Table.js';
import { LoadShape } from './LoadShape.js';
import { planSummary } from './plan.js';
import { datasets, requestRows, targetOf, thresholds } from './details.js';
import type { Body, DatasetRow, RequestRow } from './details.js';
import './overview.css';

const MAX_INPUT_NAMES = 16;
/** Names of the input files a revision references, read one by one (at most 16, cached per input). */
function useInputNames(revision: SuiteRevision, ids: string[]) {
  const api = useApi();
  const { organizationId, workspaceId } = revision.scope;
  const unique = [...new Set(ids.map((id) => id.toLowerCase()))].slice(0, MAX_INPUT_NAMES);
  const results = useQueries({
    queries: unique.map((inputId) => ({
      queryKey: queryKeys.input(organizationId, workspaceId, inputId),
      queryFn: ({ signal }: { signal: AbortSignal }) =>
        readResult(api.getInput({ params: { organizationId, workspaceId, inputId }, signal })),
    })),
  });
  return new Map(unique.map((id, index) => [id, results[index]?.data?.name ?? null]));
}

export function Overview({ revision, aside }: { revision: SuiteRevision; aside?: ReactNode }) {
  const config = revision.config;
  const plan = useMemo(() => planSummary(config), [config]);
  const requests = useMemo(() => requestRows(config), [config]);
  const data = useMemo(() => datasets(config), [config]);
  const rules = useMemo(() => thresholds(config), [config]);
  const target = targetOf(config);
  const inputIds = [
    ...requests.flatMap((row) => (row.body.kind === 'input' ? [row.body.inputId] : [])),
    ...data.flatMap((row) => (row.source.kind === 'input' ? [row.source.inputId] : [])),
  ];
  const names = useInputNames(revision, inputIds);
  const inputName = (id: string) => names.get(id.toLowerCase()) ?? 'Input file';
  const shape = plan.first;
  return (
    <div className="suite-overview">
      <div className="suite-overview-main">
        <section className="suite-plan" aria-labelledby="suite-plan-title">
          <header className="suite-plan-header">
            <h2 id="suite-plan-title">{shape?.label ?? 'Load plan unavailable'}</h2>
            {shape?.headline && <p className="suite-plan-headline">{shape.headline}</p>}
          </header>
          {shape && <p className="suite-plan-blurb">{shape.blurb}</p>}
          <LoadShape plan={plan} />
        </section>
        <section aria-labelledby="suite-requests-title">
          <h2 id="suite-requests-title" className="suite-section-title">
            {target ? `Requests against ${target}` : 'Requests'}
          </h2>
          <RequestTable requests={requests} inputName={inputName} />
        </section>
      </div>
      <aside className="suite-overview-side" aria-label="Suite facts">
        <Facts rules={rules} data={data} inputName={inputName} />
        {aside}
      </aside>
    </div>
  );
}
function RequestTable({ requests, inputName }: { requests: RequestRow[]; inputName: (id: string) => string }) {
  return (
    <Table
      caption="Requests"
      columns={[
        { key: 'request', label: 'Request' },
        { key: 'share', label: 'Share', numeric: true },
        { key: 'body', label: 'Body' },
        { key: 'checks', label: 'Checks' },
      ]}
    >
      {requests.map((row) => (
        <tr key={row.id}>
          <Td>
            <span className="muted">{row.method}</span> <span className="number">{row.path}</span>
          </Td>
          <Td numeric>{row.share === null ? '—' : `${row.share}%`}</Td>
          <Td muted={row.body.kind === 'none'}>{bodyText(row.body, inputName)}</Td>
          <Td>
            <span className="suite-checks">
              {row.checks.map((text, index) => (
                <Badge key={index}>{text}</Badge>
              ))}
              {row.checks.length === 0 && <span className="muted">None</span>}
            </span>
          </Td>
        </tr>
      ))}
    </Table>
  );
}
function datasetText(row: DatasetRow, inputName: (id: string) => string): string {
  if (row.source.kind === 'input') return inputName(row.source.inputId);
  return row.source.kind === 'inline' ? `${row.id} (${row.source.rows} inline rows)` : `${row.id} (number range)`;
}
function Facts({ rules, data, inputName }: { rules: string[]; data: DatasetRow[]; inputName: (id: string) => string }) {
  return (
    <>
      <section className="suite-thresholds" aria-labelledby="suite-pass-title">
        <h2 id="suite-pass-title" className="suite-section-title">
          Pass only if
        </h2>
        {rules.length ? (
          <ul className="suite-facts">
            {rules.map((text, index) => (
              <li key={index}>{text}</li>
            ))}
          </ul>
        ) : (
          <p className="muted">No thresholds. Runs finish without a pass or fail verdict from thresholds.</p>
        )}
      </section>
      {data.length > 0 && (
        <section className="suite-datasets" aria-labelledby="suite-data-title">
          <h2 id="suite-data-title" className="suite-section-title">
            Data
          </h2>
          <ul className="suite-facts">
            {data.map((row) => (
              <li key={row.id}>
                {datasetText(row, inputName)} <span className="muted">{row.selection}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </>
  );
}
function bodyText(body: Body, inputName: (id: string) => string) {
  if (body.kind === 'input') return inputName(body.inputId);
  return body.kind === 'inline' ? 'Inline JSON' : 'None';
}
