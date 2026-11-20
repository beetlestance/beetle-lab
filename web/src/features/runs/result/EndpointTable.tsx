import type { RunMetricEndpoint } from '@beetle/contracts/api';
import { Table, Th, Td } from '../../../components/Table.js';
import type { TableColumn } from '../../../components/Table.js';
import { formatLatency, formatNumber, formatPercent } from '../../run-results/format.js';
import type { PlanRequest } from '../live/plan.js';

type Metric = 'share' | 'rps' | 'p50' | 'p95' | 'failed';
const columns: Record<Metric, TableColumn> = {
  share: { key: 'share', label: 'Share', numeric: true },
  rps: { key: 'rps', label: 'Requests a second', numeric: true },
  p50: { key: 'p50', label: 'p50', numeric: true },
  p95: { key: 'p95', label: 'p95', numeric: true, sort: 'descending' },
  failed: { key: 'failed', label: 'Failed', numeric: true },
};
export function endpointName(row: RunMetricEndpoint, requests: readonly PlanRequest[]) {
  const request = requests.find((item) => item.label === row.request);
  return request ? `${request.method} ${request.path}` : row.request;
}
/** One semantic table, with the same measurements in responsive column order. */
export function EndpointTable({
  rows,
  requests,
  total,
  phone,
}: {
  rows: readonly RunMetricEndpoint[];
  requests: readonly PlanRequest[];
  total: number | null;
  phone: boolean;
}) {
  const order: Metric[] = phone ? ['p95', 'failed', 'share', 'rps', 'p50'] : ['share', 'rps', 'p50', 'p95', 'failed'];
  return (
    <Table
      caption="Whole-run endpoint measurements"
      scrollLabel="Endpoint measurements, scroll for more columns"
      columns={[{ key: 'endpoint', label: 'Endpoint' }, ...order.map((key) => columns[key])]}
    >
      {rows.map((row) => {
        const values = endpointValues(row, total);
        const name = endpointName(row, requests);
        return (
          <tr key={row.request}>
            <Th scope="row">
              <span className="result-endpoint-name" title={name}>
                {name}
              </span>
            </Th>
            {order.map((key) => (
              <Td key={key} numeric>
                {values[key]}
              </Td>
            ))}
          </tr>
        );
      })}
    </Table>
  );
}
function endpointValues(row: RunMetricEndpoint, total: number | null): Record<Metric, string> {
  const number = (value: number | null | undefined) => formatNumber(value, 'integer') ?? '–';
  return {
    share: formatPercent(row.requestCount !== null && total ? row.requestCount / total : null) ?? '–',
    rps: number(row.requestsPerSecond),
    p50: formatLatency(row.latency?.percentiles.p50.estimate) ?? '–',
    p95: formatLatency(row.latency?.percentiles.p95.estimate) ?? '–',
    failed: formatPercent(row.failure?.ratio) ?? '–',
  };
}
