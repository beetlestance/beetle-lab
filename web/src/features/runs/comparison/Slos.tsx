import { useMemo, useState } from 'react';
import type { RunComparisonItem, RunComparisonSlo } from '@beetle/contracts/api';
import { Table, Th, Td } from '../../../components/Table.js';
import { Button } from '../../../components/Button.js';
import { Status } from '../../../components/Badge.js';
import { ruleName } from '../live/model.js';
import { ruleValue, ruleUnit } from '../live/rule-units.js';
import { thresholdLimitText } from '../result/threshold-sentence.js';
import { comparisonRunLabels } from './run-labels.js';
const pageSize = 32;
/** At most4x256 native facts,32visible rows. Missing evidence never becomes a pass. */
export function ComparisonSlos({ items }: { items: readonly RunComparisonItem[] }) {
  const models = useMemo(
    () => items.map((item) => ({ item, rules: new Map(item.result?.slos?.map((s) => [s.id, s])) })),
    [items],
  );
  const ids = useMemo(() => [...new Set(models.flatMap((m) => [...m.rules.keys()]))], [models]);
  const [choice, setChoice] = useState(0);
  const pages = Math.max(1, Math.ceil(ids.length / pageSize));
  const page = Math.min(choice, pages - 1);
  const labels = comparisonRunLabels(items.map((i) => i.run.id));
  return (
    <section className="compare-section" aria-label="Native SLO comparisons">
      <h2>Thresholds</h2>
      <p className="compare-muted">
        Recorded native SLO verdicts and readings, not histogram estimates. Each cell keeps its own saved limit.
        Discovery triggers are excluded.
      </p>
      <SloNotes items={items} />
      {ids.length === 0 ? (
        <p>No native SLO comparisons are available.</p>
      ) : (
        <>
          <Table
            caption="Native SLO verdicts and saved limits"
            scrollLabel="Threshold comparison table"
            className="compare-different"
            columns={[
              { key: 'slo', label: 'Threshold' },
              ...items.map((item) => ({ key: item.run.id, label: labels.get(item.run.id.toLowerCase())! })),
            ]}
          >
            {ids.slice(page * pageSize, (page + 1) * pageSize).map((id) => (
              <tr key={id}>
                <Th scope="row">
                  {rowName(
                    id,
                    models.map((m) => m.rules.get(id)),
                  )}
                </Th>
                {models.map((model) => (
                  <Td key={model.item.run.id}>
                    <SloCell rule={model.rules.get(id)} available={model.item.result?.slos !== undefined} />
                  </Td>
                ))}
              </tr>
            ))}
          </Table>
          {pages > 1 && (
            <nav className="compare-head-actions" aria-label="Threshold pages">
              <Button size="sm" disabled={page === 0} onClick={() => setChoice(page - 1)}>
                Previous thresholds
              </Button>
              <span>
                {page * pageSize + 1}–{Math.min((page + 1) * pageSize, ids.length)} of {ids.length}
              </span>
              <Button size="sm" disabled={page === pages - 1} onClick={() => setChoice(page + 1)}>
                Next thresholds
              </Button>
            </nav>
          )}
        </>
      )}
    </section>
  );
}
function rowName(id: string, rules: readonly (RunComparisonSlo | undefined)[]): string {
  const rule = rules[0]?.limit;
  if (!rule || !rules.every((s) => limitKey(s?.limit) === limitKey(rule))) return id;
  return `${ruleName({ id, ...rule })}, ${thresholdLimitText(rule)}`;
}
function SloCell({ rule, available }: { rule: RunComparisonSlo | undefined; available: boolean }) {
  if (!rule) return <span className="compare-muted">{available ? 'Not recorded' : 'Unavailable'}</span>;
  const reading = rule.reading;
  return (
    <>
      <Status tone={rule.passed ? 'pass' : 'fail'}>{rule.passed ? 'Passed' : 'Failed'}</Status>
      <p className="compare-muted">
        {reading
          ? `${reading.metric} ${reading.stat}: ${ruleValue(ruleUnit(reading), reading.value)}`
          : 'Native reading unavailable.'}
      </p>
      <p className="compare-muted">{rule.limit ? thresholdLimitText(rule.limit) : 'Saved limit unavailable.'}</p>
    </>
  );
}

function SloNotes({ items }: { items: readonly RunComparisonItem[] }) {
  const labels = comparisonRunLabels(items.map((i) => i.run.id));
  return (
    <>
      {items.map((item) =>
        item.result?.slos === undefined ? (
          <p className="compare-muted" key={item.run.id}>
            {labels.get(item.run.id.toLowerCase())}: threshold details unavailable.
          </p>
        ) : item.result.completeness !== 'complete' ? (
          <p className="compare-muted" key={item.run.id}>
            {labels.get(item.run.id.toLowerCase())}: partial native evidence.
          </p>
        ) : null,
      )}
    </>
  );
}

function limitKey(limit: RunComparisonSlo['limit'] | undefined): string {
  return JSON.stringify([limit?.metric, limit?.stat, limit?.operator, limit?.value]);
}
