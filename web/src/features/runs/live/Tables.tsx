import { observedRuleValue, ruleValue } from './rule-units.js';
import { Status } from '../../../components/Badge.js';
import { Table, Td, Th } from '../../../components/Table.js';
import type { LiveFigures, RuleReading } from './model.js';
import { ruleName } from './model.js';
import { ms, percent, whole } from './format.js';

const stateText = { holding: 'Holding', over: 'Over limit', unknown: 'Checked at the end' } as const;
const stateTone = { holding: 'pass', over: 'fail', unknown: 'neutral' } as const;
const opText = { '<': 'under', '<=': 'at most', '>': 'over', '>=': 'at least' } as const;

/** Latest-window readings of the revision's thresholds. The verdict is the sealed result's. */
export function Thresholds({ readings }: { readings: readonly RuleReading[] }) {
  if (!readings.length) return null;
  return (
    <section className="live-thresholds" aria-labelledby="live-thresholds">
      <h2 id="live-thresholds">Thresholds</h2>
      <ul>
        {readings.map((reading) => {
          const fmt = (value: number) => ruleValue(reading.unit, value);
          const fill =
            reading.value === null || reading.rule.value <= 0
              ? 0
              : Math.min(100, (reading.value / reading.rule.value) * 100);
          return (
            <li key={reading.rule.id} className={`live-threshold is-${reading.state}`}>
              <div className="live-threshold-head">
                <Status tone={stateTone[reading.state]}>{stateText[reading.state]}</Status>
                <span className="number">
                  {reading.value !== null && (
                    <>
                      {reading.bound === 'at-most' ? '≤ ' : ''}
                      {observedRuleValue(reading.unit, reading.value, reading.rule.value)}{' '}
                    </>
                  )}
                  {opText[reading.rule.operator]} {fmt(reading.rule.value)}
                </span>
              </div>
              <p>{ruleName(reading.rule)}</p>
              {reading.value !== null && (
                <span className="live-meter" aria-hidden="true">
                  <span style={{ width: `${fill}%` }} />
                </span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="live-note">Latest window only. The pass or fail verdict comes when the run is sealed.</p>
    </section>
  );
}

const columns = [
  { key: 'endpoint', label: 'Endpoint' },
  { key: 'share', label: 'Share', numeric: true },
  { key: 'rps', label: 'Requests a second', numeric: true },
  { key: 'p50', label: 'p50', numeric: true },
  { key: 'p95', label: 'p95', numeric: true, sort: 'descending' as const },
  { key: 'failed', label: 'Failed', numeric: true },
];

export function Endpoints({ figures }: { figures: LiveFigures }) {
  const rows = figures.endpoints;
  if (!rows.length) return null;
  return (
    <section className="live-endpoints" aria-labelledby="live-endpoints">
      <h2 id="live-endpoints">
        Where the requests go <span className="live-count">{rows.length} endpoints</span>
      </h2>
      <Table caption="Endpoints in the latest live window" columns={columns} scrollLabel="Live endpoint metrics">
        {rows.map((row) => (
          <tr key={row.label}>
            <Th scope="row">
              {row.request ? (
                <>
                  <span className="live-method">{row.request.method}</span> {row.request.path}
                </>
              ) : (
                row.label
              )}
              {!row.live && <span className="live-muted"> · not in live view</span>}
            </Th>
            <Td numeric>{row.share === null ? '–' : percent(row.share)}</Td>
            <Td numeric>{row.rps === null ? '–' : whole(row.rps)}</Td>
            <Td numeric>{row.p50 === null ? '–' : ms(row.p50)}</Td>
            <Td numeric>{row.p95 === null ? '–' : ms(row.p95)}</Td>
            <Td numeric>{row.failed === null ? '–' : percent(row.failed)}</Td>
          </tr>
        ))}
      </Table>
      <p className="live-note live-endpoint-scroll-note">
        p95 and Failed stay in view. Scroll sideways for share, request rate and p50.
      </p>
      {figures.excludedSeries > 0 && (
        <p className="live-note">
          {figures.excludedSeries} more series are recorded but not in the live view; all of them are in the result.
        </p>
      )}
    </section>
  );
}
