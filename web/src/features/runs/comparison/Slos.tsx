import { useMemo, useState } from 'react';
import type { RunComparisonItem, RunComparisonSlo } from '@beetle/contracts/api';
import type { ReactNode } from 'react';
import { Th, Td } from '../../../components/Table.js';
import { Button } from '../../../components/Button.js';
import { ruleName } from '../live/model.js';
import { ruleValue, ruleUnit } from '../live/rule-units.js';
import { thresholdLimitText } from '../result/threshold-sentence.js';
import { comparisonRunLabels } from './run-labels.js';
const pageSize = 32;
/** At most4x256 native facts,32visible rows. Missing evidence never becomes a pass. */
export function ComparisonSlos({
  items,
  children,
}: {
  items: readonly RunComparisonItem[];
  children(rows: ReactNode): ReactNode;
}) {
  const models = useMemo(
    () => items.map((item) => ({ item, rules: new Map(item.result?.slos?.map((s) => [s.id, s])) })),
    [items],
  );
  const ids = useMemo(() => [...new Set(models.flatMap((m) => [...m.rules.keys()]))], [models]);
  const [choice, setChoice] = useState(0);
  const pages = Math.max(1, Math.ceil(ids.length / pageSize));
  const page = Math.min(choice, pages - 1);
  return (
    <section className="compare-section" aria-label="Native SLO comparisons">
      <SloNotes items={items} />
      {ids.length === 0 ? (
        <>
          {children(null)}
          <p className="compare-muted">No native SLO comparisons are available.</p>
        </>
      ) : (
        <>
          {children(
            <>
              {ids.slice(page * pageSize, (page + 1) * pageSize).map((id) => (
                <tr key={id} className="compare-slo-row">
                  <Th scope="row">
                    {rowName(
                      id,
                      models.map((m) => m.rules.get(id)),
                    )}
                  </Th>
                  {models.map((model) => (
                    <Td key={model.item.run.id}>
                      <SloCell
                        rule={model.rules.get(id)}
                        available={model.item.result?.slos !== undefined}
                        common={models.every(
                          (m) => limitKey(m.rules.get(id)?.limit) === limitKey(models[0]?.rules.get(id)?.limit),
                        )}
                      />
                    </Td>
                  ))}
                </tr>
              ))}
            </>,
          )}
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
  const label =
    rule.metric === 'http_req_duration'
      ? rule.stat
      : rule.metric === 'checks'
        ? 'checks'
        : rule.metric === 'http_req_failed'
          ? 'failed requests'
          : ruleName({ id, ...rule });
  return `${label} ${thresholdLimitText(rule)
    .replace(/^limit /, '')
    .replace(/^over /, 'above ')}`;
}
function SloCell({
  rule,
  available,
  common,
}: {
  rule: RunComparisonSlo | undefined;
  available: boolean;
  common: boolean;
}) {
  if (!rule) return <span className="compare-muted">{available ? 'Not recorded' : 'Unavailable'}</span>;
  const reading = rule.reading;
  return (
    <span className={rule.passed ? 'compare-slo-pass' : 'compare-slo-fail'}>
      <span>{rule.passed ? 'Passed' : 'Failed'}</span>
      {', '}
      {reading ? (
        <>
          <span className="sr-only">
            {reading.metric} {reading.stat}:{' '}
          </span>
          {ruleValue(ruleUnit(reading), reading.value)}
        </>
      ) : (
        <span>Native reading unavailable.</span>
      )}
      <span className={common && rule.limit ? 'sr-only' : 'compare-own-limit'}>
        {rule.limit ? thresholdLimitText(rule.limit) : 'Saved limit unavailable.'}
      </span>
    </span>
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
