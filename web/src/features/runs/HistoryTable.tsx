import type { RunPage } from '@beetle/contracts/api';
import { Link } from 'react-router-dom';
import { routes } from '../../app/routes.js';
import { Badge, Status } from '../../components/Badge.js';
import { Table, Td } from '../../components/Table.js';
import { formatTime, runStatus, shortId, startedAt } from '../run-results/format.js';
import { HistorySummaryCells } from './HistorySummaryCells.js';
import { terminal } from './terminal.js';
import type { RunScope } from './types.js';

const columns = [
  { key: 'select', label: <span className="sr-only">Compare</span> },
  { key: 'run', label: 'Run' },
  { key: 'result', label: 'Result' },
  { key: 'started', label: 'Started' },
  { key: 'length', label: 'Length', numeric: true },
  { key: 'rps', label: 'Requests a second', numeric: true },
  { key: 'p95', label: 'p95', numeric: true },
  { key: 'failed', label: 'Failed', numeric: true },
] as const;

export function HistoryTable({
  scope,
  page,
  selected,
  toggle,
  name,
  caption,
}: {
  scope: RunScope;
  page: RunPage;
  selected: readonly string[];
  toggle(id: string): void;
  name(suiteId: string): string | undefined;
  caption: string;
}) {
  return (
    <Table caption={caption} columns={columns} className="history-table">
      {page.items.map((run, index) => {
        const status = runStatus(run);
        const started = startedAt(run);
        const suite = name(run.suiteId);
        const position = selected.indexOf(run.id);
        return (
          <tr key={run.id} aria-selected={position >= 0 || undefined}>
            <Td>
              <input
                type="checkbox"
                className="history-check"
                aria-label={`Compare run ${shortId(run.id)}`}
                checked={position >= 0}
                disabled={!terminal(run) || (position < 0 && selected.length >= 4)}
                onChange={() => toggle(run.id)}
              />
            </Td>
            <th scope="row" className="history-run">
              <Link to={routes.run(scope.organizationId, scope.workspaceId, run.id)} className="history-run-link">
                <span className="history-suite">{suite ?? 'Suite'}</span>{' '}
                <span className="number history-id">{shortId(run.id)}</span>
                <span className="sr-only">, run {run.id}</span>
              </Link>
              {run.pinned && <Badge tone="strong">Pinned</Badge>}
              {position === 0 && <Badge tone="amber">Baseline</Badge>}
              {run.note && <span className="history-note">{run.note}</span>}
            </th>
            <Td>
              <Status tone={status.tone}>{status.label}</Status>
            </Td>
            <Td muted>
              <time dateTime={started.iso} title={started.recorded ? 'Started' : 'Requested; start not recorded'}>
                {formatTime(started.iso)}
              </time>
            </Td>
            <HistorySummaryCells value={page.summaries[index]!} />
          </tr>
        );
      })}
    </Table>
  );
}
