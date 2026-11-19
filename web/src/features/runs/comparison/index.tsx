import { Link, useLocation } from 'react-router-dom';
import { routes } from '../../../app/routes.js';
import { Badge, Status } from '../../../components/Badge.js';
import { Button, buttonClass } from '../../../components/Button.js';
import { runStatus } from '../../run-results/format.js';
import type { RunScope } from '../types.js';
import { ComparisonDeltas, WhatWasDifferent } from './Deltas.js';
import { ComparisonFacts } from './Facts.js';
import { ComparedMetric, MetricSelection } from './Metric.js';
import { comparisonRunIds } from './selection.js';
import { comparisonRunLabels } from './run-labels.js';
import { useComparison } from './useComparison.js';
import { RecordedComparisonCharts } from './RecordedCharts.js';
import './comparison.css';

export function RunComparison(scope: RunScope) {
  const { search } = useLocation();
  if (!new URLSearchParams(search).has('runs')) return <CompareEmpty scope={scope} />;
  const ids = comparisonRunIds(search);
  if (!ids)
    return (
      <section className="compare">
        <h1>Invalid comparison</h1>
        <p>Select two to four distinct runs in workspace history.</p>
        <Link className={buttonClass('secondary')} to={routes.runs(scope.organizationId, scope.workspaceId)}>
          Go to runs
        </Link>
      </section>
    );
  return <Comparison scope={scope} ids={ids} />;
}

/** Compare / Empty: no runs were picked. */
function CompareEmpty({ scope }: { scope: RunScope }) {
  return (
    <section className="compare compare-empty">
      <h1>Pick runs to compare</h1>
      <p>
        Tick two to four finished runs in Runs. The first one is the baseline, and every other run shows how far it
        moved from it.
      </p>
      <Link className={buttonClass('primary')} to={routes.runs(scope.organizationId, scope.workspaceId)}>
        Go to runs
      </Link>
      <p className="compare-muted">Only finished runs can be compared. A running one joins when it ends.</p>
    </section>
  );
}

type ComparisonState = ReturnType<typeof useComparison>;
type Snapshot = NonNullable<ComparisonState['view']['snapshot']>;

function Comparison({ scope, ids }: { scope: RunScope; ids: string[] }) {
  const state = useComparison(scope, ids);
  const snapshot = state.view.snapshot;
  const { organizationId, workspaceId } = scope;
  return (
    <section className="compare">
      <ComparisonHeader scope={scope} ids={ids} state={state} />
      {state.view.busy && <p role="status">Loading comparison…</p>}
      {state.view.error && <p role="alert">Comparison could not be loaded. Use Refresh comparison to retry.</p>}
      {snapshot && (
        <>
          <RunStrip scope={scope} ids={ids} snapshot={snapshot} contexts={state.contexts} />
          <ComparisonDeltas
            items={snapshot.items}
            summaries={state.summaries}
            overviews={state.overviews}
            histories={state.histories}
          />
          <section className="compare-section" aria-labelledby="compare-different">
            <h2 id="compare-different">What was different</h2>
            <WhatWasDifferent items={snapshot.items} />
          </section>
          <RecordedComparisonCharts
            key={ids.join(',')}
            items={snapshot.items}
            histories={state.histories}
            overviews={state.overviews}
          />
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
        </>
      )}
    </section>
  );
}

function ComparisonHeader({ scope, ids, state }: { scope: RunScope; ids: string[]; state: ComparisonState }) {
  const context = state.contexts?.get(ids[0]!.toLowerCase());
  const label = comparisonRunLabels(ids).get(ids[0]!)!;
  return (
    <header className="compare-head">
      <div>
        <h1>{context ? `${ids.length} runs, baseline ${context.suiteName} ${label}` : 'Compare runs'}</h1>
        <p className="compare-lede">
          {!context && (
            <>
              {ids.length} runs, baseline <span className="number">{label}</span>.{' '}
            </>
          )}
          Differences describe recorded evidence, not a statistical comparability verdict.
        </p>
      </div>
      <div className="compare-head-actions">
        <Link className={buttonClass('text', 'sm')} to={routes.runs(scope.organizationId, scope.workspaceId)}>
          Back to run history
        </Link>
        <Button size="sm" disabled={state.busy} onClick={state.retry}>
          Refresh comparison
        </Button>
      </div>
    </header>
  );
}

function RunStrip({
  scope,
  ids,
  snapshot,
  contexts,
}: {
  scope: RunScope;
  ids: string[];
  snapshot: Snapshot;
  contexts: ComparisonState['contexts'];
}) {
  const { organizationId, workspaceId } = scope;
  const labels = comparisonRunLabels(ids);
  return (
    <ul className="compare-runs" aria-label="Compared runs">
      {snapshot.items.map((item, index) => {
        const status = runStatus(item.run);
        const context = contexts?.get(item.run.id.toLowerCase());
        const label = labels.get(item.run.id.toLowerCase())!;
        const others = ids.filter((id) => id !== item.run.id.toLowerCase());
        return (
          <li key={item.run.id} className="compare-run">
            <Status tone={status.tone}>{status.label}</Status>
            <Link to={routes.run(organizationId, workspaceId, item.run.id)}>
              {context?.suiteName && <span>{context.suiteName} </span>}
              <span className="number">{label}</span>
              <span className="sr-only">, run {item.run.id}</span>
            </Link>
            <span className="compare-muted">
              {context ? `revision ${context.revisionOrdinal}` : 'Revision unknown'}
            </span>
            {index === 0 ? (
              <Badge tone="amber">Baseline</Badge>
            ) : (
              <Link
                className={buttonClass('text', 'sm')}
                to={routes.comparison(organizationId, workspaceId, [item.run.id.toLowerCase(), ...others])}
                aria-label={`Make ${label} the baseline`}
              >
                Make baseline
              </Link>
            )}
          </li>
        );
      })}
    </ul>
  );
}

function MetricSection({ state, snapshot }: { state: ComparisonState; snapshot: Snapshot }) {
  return (
    <section className="compare-section" aria-labelledby="compare-metric">
      <h2 id="compare-metric">One metric, per run</h2>
      {state.view.page ? (
        <MetricSelection page={state.view.page} busy={state.busy} select={state.select} next={state.page} />
      ) : (
        <Button size="sm" disabled={state.busy} onClick={() => state.page()}>
          Choose another metric
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
