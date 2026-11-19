import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { routes } from '../../../app/routes.js';
import { Button } from '../../../components/Button.js';
import type { RunScope } from '../types.js';
import type { useComparison } from './useComparison.js';
import { ComparedMetric, MetricSelection } from './Metric.js';
import { ComparisonFacts } from './Facts.js';

type ComparisonState = ReturnType<typeof useComparison>;
type Snapshot = NonNullable<ComparisonState['view']['snapshot']>;

/** Expansion belongs to the view so a metric read cannot close its controls. */
export function useAdvancedExpansion(identity: string, catalogueError: boolean) {
  const [saved, setSaved] = useState({ identity, open: false });
  useEffect(() => {
    if (catalogueError) setSaved({ identity, open: true });
  }, [identity, catalogueError]);
  return [
    (saved.identity === identity && saved.open) || catalogueError,
    (open: boolean) => setSaved({ identity, open }),
  ] as const;
}

/** Keep detailed per-series exploration available without replacing the board's overview. */
export function AdvancedComparison({
  scope,
  state,
  snapshot,
  expanded,
  onExpandedChange,
}: {
  scope: RunScope;
  state: ComparisonState;
  snapshot: Snapshot;
  expanded: boolean;
  onExpandedChange: (open: boolean) => void;
}) {
  const { organizationId, workspaceId } = scope;
  return (
    <details className="compare-advanced" open={expanded}>
      <summary
        onClick={(event) => {
          event.preventDefault();
          onExpandedChange(!expanded);
        }}
      >
        Explore metrics and recorded evidence
      </summary>
      <div className="compare-advanced-content">
        <MetricSection state={state} snapshot={snapshot} />
        {snapshot.items.map((item, index) => (
          <article key={item.run.id} className="compare-section">
            <h2>
              {index === 0 ? 'Baseline' : `Run ${index + 1}`}:{' '}
              <Link to={routes.run(organizationId, workspaceId, item.run.id)}>{item.run.id}</Link>
            </h2>
            <ComparedMetric item={item} admission={state.admission} />
            <details className="compare-evidence">
              <summary>Recorded evidence and fingerprints</summary>
              <ComparisonFacts item={item} />
            </details>
          </article>
        ))}
      </div>
    </details>
  );
}

function MetricSection({ state, snapshot }: { state: ComparisonState; snapshot: Snapshot }) {
  return (
    <section className="compare-section" aria-labelledby="compare-metric">
      <h2 id="compare-metric">One metric, per run</h2>
      {state.view.catalogueError && (
        <p role="alert">Metric catalogue could not be loaded. The comparison remains available.</p>
      )}
      {state.view.page ? (
        <MetricSelection page={state.view.page} busy={state.busy} select={state.select} next={state.page} />
      ) : (
        <Button size="sm" disabled={state.busy} onClick={() => state.page()}>
          {state.view.catalogueError ? 'Retry metric catalogue' : 'Choose another metric'}
        </Button>
      )}
      {snapshot.metricBinding && (
        <p>
          Logical request: {snapshot.metricBinding.requestId ?? 'aggregate'}; assertion:{' '}
          {snapshot.metricBinding.assertionId ?? 'none'}.
        </p>
      )}
      <p className="compare-muted">
        Charts use each run’s own UTC source time and independent vertical scale; timelines are not aligned.
      </p>
    </section>
  );
}
