import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import type { RunComparisonItem } from '@beetle/contracts/api';
import { routes } from '../../../app/routes.js';
import { LiveChart } from '../live/LiveChart.js';
import { comparisonNumber } from './resting-values.js';
import type { ComparisonHistories } from './useComparison.js';
import type { ComparisonTargets, ComparisonTargetRead } from './target-read.js';
import { comparisonTargetSources, comparisonTargetCards } from './target-model.js';
import { ComparisonSourceNotes } from './SourceNotes.js';
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
  return (
    <section className="compare-section compare-chart-section" aria-label="Target runtime comparison">
      <header className="compare-chart-heading">
        <h2>Target runtime</h2>
        <p className="compare-muted">
          Resting legends use recorded during-phase means; hover shows observations. Only matching metrics with declared
          compatible units share a scale. No phase alignment or gap filling.
        </p>
      </header>
      <TargetSourceNotes items={items} targets={targets} sources={sources} cards={cards} />
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
                format={(value) => `${comparisonNumber(value)} ${card.unit}`}
              />
              {card.series.length < items.length && (
                <p className="compare-muted">
                  Source metric: {card.metric}. {items.length - card.series.length} runs have no comparable readings.
                </p>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}

function TargetSourceNotes({
  items,
  targets,
  sources,
  cards,
}: {
  items: readonly RunComparisonItem[];
  targets: ComparisonTargets | undefined;
  sources: ReturnType<typeof comparisonTargetSources>;
  cards: ReturnType<typeof comparisonTargetCards>;
}) {
  const labels = comparisonRunLabels(items.map((item) => item.run.id));
  return (
    <ComparisonSourceNotes
      notes={items.map((item) => {
        const id = item.run.id.toLowerCase(),
          read = targets?.get(id),
          source = sources.find((s) => s.id === id);
        const scope = item.run.scope;
        return {
          id,
          attention: !source || source.report.missed > 0 || source.report.limited || source.report.samples.length === 0,
          content: (
            <p className="compare-muted" key={id}>
              {labels.get(id)}: {targetNotice(source, read)}{' '}
              <Link to={routes.run(scope.organizationId, scope.workspaceId, item.run.id) + '#result-target'}>
                Inspect this run’s target evidence
              </Link>
            </p>
          ),
        };
      })}
      extra={cards
        .filter(
          (card) => card.series.length === items.length && card.series.some((s) => s.values.some((v) => v !== null)),
        )
        .map((card) => (
          <p className="compare-muted" key={card.id}>
            Source metric: {card.metric} ({card.unit}).
          </p>
        ))}
    />
  );
}

type TargetSource = ReturnType<typeof comparisonTargetSources>[number];
function targetNotice(source: TargetSource | undefined, read: ComparisonTargetRead | undefined): string {
  if (source)
    return `${source.report.samples.length} observations; ${source.report.missed} missed.${source.report.limited ? ' Collection was limited.' : ''}`;
  if (read?.status === 'disabled') return 'target sampling was disabled.';
  if (read?.status === 'error') return 'target report could not be verified or loaded. Refresh comparison to retry.';
  if (read?.status === 'ready') return 'target report has no compatible native timing or chronology for this overlay.';
  return 'target report unavailable.';
}
