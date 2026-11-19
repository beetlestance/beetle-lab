import { useMemo, useState } from 'react';
import type { LiveMetricHistory } from '@beetle/contracts/api';
import { Button } from '../../../components/Button.js';
import { MetricWindows } from '../charts/MetricWindows.js';
import { chartDomain, TargetRuntime } from '../live/Charts.js';
import { mergeHistory, recordedCount } from '../live/backfill.js';
import { clock } from '../live/format.js';
import { emptyHistory } from '../live/history.js';
import type { RunPlan } from '../live/plan.js';
import type { ResultReads } from './useResultReads.js';

export function recoveredHistoryState(reads: ResultReads) {
  if (!reads.chartHistory.isSuccess || reads.chartHistory.data.reason !== 'not_recorded') return;
  const query = reads.stoppedHistory;
  if (query.isError || query.isFetching || query.data) return query;
}

export function resultSections(reads: ResultReads, showTarget: boolean) {
  const recovered = recoveredHistoryState(reads);
  const target = recovered?.isSuccess && Boolean(recovered.data?.targetSamples?.length);
  return {
    recoveredCharts: Boolean(recovered),
    hideTarget: !showTarget && !target,
    sealedTarget: showTarget && !target,
  };
}

export function RecoveredHistory({ query, plan }: { query: ResultReads['stoppedHistory']; plan: RunPlan }) {
  return (
    <section id="result-charts" className="result-section" aria-label="Recovered charts">
      {query.isError ? (
        <p role="status">
          Recovered history could not be read.{' '}
          <Button variant="text" size="sm" onClick={() => void query.refetch()}>
            Retry history
          </Button>
        </p>
      ) : query.data ? (
        <RecoveredCharts data={query.data} plan={plan} />
      ) : (
        <p role="status">Reading recovered history…</p>
      )}
    </section>
  );
}

function RecoveredCharts({ data, plan }: { data: LiveMetricHistory; plan: RunPlan }) {
  const [hoverT, onHover] = useState<number | null>(null);
  const hover = { hoverT, onHover };
  const history = useMemo(() => mergeHistory(emptyHistory(null), data, plan, null), [data, plan]);
  const domain = chartDomain(history, plan);
  const ticks = domain.map((at) => ({ at, label: clock(at) }));
  return (
    <>
      <h2 className="result-section-title">Recovered before the stop</h2>
      <p className="result-muted">
        {recordedCount(history)} of {data.prefix.windows} recorded windows shown. Time starts at the first retained
        window. The verified archive is unavailable, so these charts cover only the retained observations.
      </p>
      <MetricWindows points={history.points} domain={domain} hover={hover} ticks={ticks} strictHoverRange />
      {history.target.length > 0 && (
        <div id="result-target">
          <TargetRuntime
            history={history}
            domain={domain}
            origin={null}
            hover={hover}
            units={plan.targetUnits}
            recovered
          />
        </div>
      )}
    </>
  );
}
