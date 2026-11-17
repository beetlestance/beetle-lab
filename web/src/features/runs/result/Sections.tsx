import type { EngineResult } from '@beetle/contracts';
import type { Run, RunHistorySummary, Suite, SuiteRevision } from '@beetle/contracts/api';
import { Link } from 'react-router-dom';
import { routes } from '../../../app/routes.js';
import { Status } from '../../../components/Badge.js';
import { buttonClass } from '../../../components/Button.js';
import { formatDuration, formatNumber, formatPercent, formatTime, shortId } from '../../run-results/format.js';
import { summaryStatus } from '../HistorySummaryCells.js';
import type { Variant } from './headline.js';

/** Whole-run tiles from the run's stored history summary; unknown values are left out. */
export function SummaryTiles({ summary, status }: { summary: RunHistorySummary | null; status: string }) {
  if (status === 'loading') return <p className="result-muted">Loading whole-run figures…</p>;
  if (!summary)
    return (
      <p className="result-muted">
        {status === 'error' ? 'Whole-run figures could not be loaded.' : 'No whole-run figures were recorded.'}
      </p>
    );
  const note = summaryStatus(summary);
  const tiles = [
    { value: formatNumber(summary.requestsPerSecond, 'integer'), label: 'a second on average' },
    {
      value: summary.httpP95 ? `${formatNumber(summary.httpP95.estimate, 'integer')} ms` : null,
      label: 'p95, histogram estimate',
    },
    {
      value: formatPercent(summary.httpFailureRatio),
      label:
        summary.httpSamples === null
          ? 'of requests failed'
          : `failed of ${formatNumber(summary.httpSamples, 'integer')} requests`,
    },
    { value: formatNumber(summary.requestCount, 'integer'), label: 'requests' },
    { value: formatDuration(summary.testDurationMs), label: 'test length' },
  ].filter((tile) => tile.value !== null);
  return (
    <>
      {tiles.length > 0 ? (
        <dl className="result-tiles">
          {tiles.map((tile) => (
            <div key={tile.label}>
              <dt>{tile.label}</dt>
              <dd>{tile.value}</dd>
            </div>
          ))}
        </dl>
      ) : (
        <p className="result-muted">Whole-run figures are not available.</p>
      )}
      {note && <p className="result-muted">Figures: {note.toLowerCase()}.</p>}
    </>
  );
}

const stoppedEarly: readonly Variant[] = ['cancelled', 'out-of-memory', 'output-full', 'errored'];
export function Thresholds({
  result,
  status,
  variant,
}: {
  result: EngineResult | null;
  status: string;
  variant: Variant;
}) {
  if (!result)
    return (
      <p className="result-muted">
        {status === 'loading'
          ? 'Loading thresholds…'
          : status === 'error'
            ? 'Thresholds could not be loaded.'
            : 'No engine result was published, so thresholds are unavailable.'}
      </p>
    );
  const assertions = result.requiredAssertions;
  return (
    <>
      {stoppedEarly.includes(variant) && (
        <p className="result-muted">The run stopped early. These are the engine's readings on a partial run.</p>
      )}
      {result.thresholds.length === 0 ? (
        <p className="result-muted">No thresholds were declared.</p>
      ) : (
        <ul className="result-thresholds" aria-label="Thresholds">
          {result.thresholds.map((threshold, index) => (
            <li key={`${threshold.id}/${index}`} className="result-card">
              <Status tone={threshold.passed ? 'pass' : 'fail'}>{threshold.passed ? 'Passed' : 'Failed'}</Status>
              <span className="result-threshold-name">{threshold.id}</span>
              <span className="result-muted">{threshold.purpose}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="result-muted">
        {assertions.passed} of {assertions.required} required checks passed
        {assertions.failed ? `, ${assertions.failed} failed` : ''}
        {assertions.unknown ? `, ${assertions.unknown} unknown` : ''}. Evidence is {result.completeness}.
      </p>
    </>
  );
}

/** "Revision 3 of checkout, the latest": what is known of the revision this run used. */
function revisionTitle(run: Run, suite: Suite | undefined, revision: SuiteRevision | undefined): string {
  const name = revision ? `Revision ${revision.ordinal}` : 'Saved revision';
  if (!suite) return name;
  const latest = suite.currentRevisionId?.toLowerCase() === run.revisionId.toLowerCase();
  return `${name} of ${suite.name}${latest ? ', the latest' : ''}`;
}

/** ", saved <time> by Meera: message" after the config digest; parts left out when unknown. */
function savedLine(revision: SuiteRevision): string {
  const by = revision.savedBy ? ` by ${revision.savedBy}` : '';
  const saved = revision.savedAt ? `, saved ${formatTime(revision.savedAt)}${by}` : '';
  return `${saved}${revision.message ? `: ${revision.message}` : ''}`;
}

export function ScriptVersion({
  run,
  suite,
  revision,
  failed,
}: {
  run: Run;
  suite: Suite | undefined;
  revision: SuiteRevision | undefined;
  failed: boolean;
}) {
  const { organizationId, workspaceId } = run.scope;
  return (
    <section className="result-card result-script" aria-labelledby="result-script-title">
      <h2 id="result-script-title">Script version</h2>
      <p>{revisionTitle(run, suite, revision)}</p>
      <p className="result-muted">
        Config <span className="number">{run.revisionDigest.slice(0, 8)}</span>
        {revision ? savedLine(revision) : ''}
      </p>
      {failed && <p className="result-muted">Revision details could not be loaded.</p>}
      <p className="result-muted">
        Engine {run.engine.id} ({run.engine.profileId}), run <span className="number">{shortId(run.id)}</span>.
      </p>
      <div className="result-row">
        <Link
          className={buttonClass('secondary', 'sm')}
          to={routes.suiteScript(organizationId, workspaceId, run.suiteId, run.revisionId)}
        >
          View script
        </Link>
        <Link className={buttonClass('text', 'sm')} to={routes.suite(organizationId, workspaceId, run.suiteId)}>
          Open suite
        </Link>
      </div>
    </section>
  );
}
