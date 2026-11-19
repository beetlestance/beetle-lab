import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunComparisonItem } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { LiveChart } from '../live/LiveChart.js';
import { reading } from '../live/format.js';
import type { ComparisonHistories } from './useComparison.js';
import type { ComparisonTargets } from './target-read.js';
import { comparisonTargetSources, comparisonTargetCards } from './target-model.js';
import { comparisonRunLabels } from './run-labels.js';
export function ComparisonTargetRuntime({
  items,
  targets,
  histories,
}: {
  items: readonly RunComparisonItem[];
  targets: ComparisonTargets | undefined;
  histories: ComparisonHistories | undefined;
}) {
  const sources = useMemo(() => comparisonTargetSources(items, targets, histories), [items, targets, histories]);
  const cards = useMemo(() => comparisonTargetCards(sources), [sources]);
  const [hoverT, onHover] = useState<number | null>(null);
  const labels = comparisonRunLabels(items.map((i) => i.run.id));
  return (
    <section className="compare-section" aria-label="Target runtime comparison">
      <h2>Target runtime</h2>
      <p className="compare-muted">
        Target-reported observations, relative to each run’s native marker. Only matching metrics with declared
        compatible units share a scale. No phase alignment or gap filling.
      </p>
      {items.map((item) => {
        const id = item.run.id.toLowerCase(),
          read = targets?.get(id),
          source = sources.find((s) => s.id === id);
        const scope = item.run.scope;
        return (
          <p className="compare-muted" key={id}>
            {labels.get(id)}:{' '}
            {source
              ? `${source.report.samples.length} observations; ${source.report.missed} missed.${source.report.limited ? ' Collection was limited.' : ''}`
              : read?.status === 'disabled'
                ? 'target sampling was disabled.'
                : read?.status === 'error'
                  ? 'target report could not be verified or loaded. Refresh comparison to retry.'
                  : read?.status === 'ready'
                    ? 'target report has no compatible native timing or chronology for this overlay.'
                    : 'target report unavailable.'}{' '}
            <Link to={routes.run(scope.organizationId, scope.workspaceId, item.run.id) + '#result-target'}>
              Inspect this run’s target evidence
            </Link>
          </p>
        );
      })}
      <div className="live-charts">
        {cards.map((card) => {
          if (!card.series.some((s) => s.values.some((v) => v !== null)))
            return <p key={card.id}>{card.title}: no shared metric with usable declared readings.</p>;
          return (
            <div key={card.id}>
              <LiveChart
                title={card.title}
                xs={card.series[0]?.xs ?? []}
                series={card.series}
                domain={card.domain}
                ticks={card.ticks}
                strictHoverRange
                hoverT={hoverT}
                onHover={onHover}
                format={(value) => `${reading(value)} ${card.unit}`}
              />
              <p className="compare-muted">
                Source metric: {card.metric}. {items.length - card.series.length} runs have no comparable readings.
              </p>
            </div>
          );
        })}
      </div>
    </section>
  );
}
