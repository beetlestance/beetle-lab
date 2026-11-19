import { useSearchParams } from 'react-router-dom';
import { Button } from '../../../components/Button.js';
import type { RunPlan } from '../live/plan.js';

export function usePhaseMode() {
  const [search, setSearch] = useSearchParams();
  const phaseView = search.get('target') === 'phases';
  return {
    phaseView,
    className: phaseView ? 'result result-phase-view' : 'result',
    togglePhases: () => {
      const next = new URLSearchParams(search);
      if (phaseView) next.delete('target');
      else next.set('target', 'phases');
      setSearch(next);
    },
  };
}
export function TargetHeader({
  plan,
  phaseView,
  togglePhases,
}: {
  plan: RunPlan;
  phaseView: boolean;
  togglePhases: () => void;
}) {
  return (
    <header className="live-section-head">
      <div>
        {phaseView ? (
          <>
            <h1 id="result-target-title">
              How {plan.targetOrigin ?? 'the target'} behaved before, during and after load
            </h1>
            <TargetSourceNote plan={plan} />
          </>
        ) : (
          <h2 id="result-target-title" className="result-section-title">
            Target runtime
          </h2>
        )}
      </div>
      <div>
        {!phaseView && <TargetSourceNote plan={plan} />}
        <Button size="sm" variant="text" onClick={togglePhases}>
          {phaseView ? 'Back to run result' : 'Compare recorded phases'}
        </Button>
      </div>
    </header>
  );
}
function TargetSourceNote({ plan }: { plan: RunPlan }) {
  if (!plan.targetOrigin) return null;
  const interval = plan.samplingIntervalMs;
  const cadence =
    interval !== null && interval >= 1000 && interval <= 60000 ? ` · Configured interval ${interval / 1000} s` : '';
  return (
    <p className="result-muted result-target-source">
      Target: {plan.targetOrigin}
      {cadence}.
    </p>
  );
}
