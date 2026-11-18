import type { ReactNode } from 'react';
import { useState } from 'react';
import type { Config } from '../suites/draft.js';
import { Button } from '../../components/Button.js';
import { Card, TextField } from './fields.js';
import { LoadShape } from '../suite-overview/LoadShape.js';
import { planSummary } from '../suite-overview/plan.js';
import { executors, rampHoldDrain } from './load.js';
import { firstScenario, isObj, list, setScenario } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { ExecutorSelect, ScenarioFields } from './ScenarioFields.js';

/** About shares one draft for suite details and the revision target. */
export function AboutSection({ config, set, metadata }: { config: Config; set: SetConfig; metadata?: ReactNode }) {
  return (
    <Card title="About">
      {metadata}
      <TextField
        label="Target URL"
        path="/target"
        value={config.target}
        change={(target) => set({ ...config, target })}
      />
    </Card>
  );
}

const isSimple = (scenario: Obj | undefined) => !!scenario && !!rampHoldDrain(scenario);

/** Whether the first scenario uses the ramp/hold/drain view, decided once per executor. */
function useSimpleView(scenario: Obj | undefined) {
  const executor = scenario?.executor;
  // Decided per executor so a half-typed value does not swap the layout while typing.
  const [simple, setSimple] = useState(() => ({ executor, on: isSimple(scenario) }));
  if (simple.executor !== executor) setSimple({ executor, on: isSimple(scenario) });
  return simple.on;
}

export function LoadSection({ config, set, openSetup }: { config: Config; set: SetConfig; openSetup: () => void }) {
  const scenario = firstScenario(config);
  const simple = useSimpleView(scenario);
  const count = isObj(config.loadPlan) ? list(config.loadPlan.scenarios).length : 0;
  if (!scenario)
    return (
      <Card title="How load arrives">
        <p className="editor-note">This draft has no load scenario. Add one in Run setup or the complete JSON.</p>
      </Card>
    );
  const plan = planSummary(config);
  const hint = executors.find((item) => item.id === scenario.executor)?.hint;
  const change = (next: Obj) => set(setScenario(config, 0, next));
  return (
    <Card title="How load arrives">
      <ExecutorSelect scenario={scenario} path="/loadPlan/scenarios/0" set={change} />
      {hint && <p className="editor-note">{hint}</p>}
      <ScenarioFields scenario={scenario} path="/loadPlan/scenarios/0" simple={simple} set={change} />
      {plan.first && (
        <div className="editor-load-preview">
          <LoadShape plan={plan} />
        </div>
      )}
      {count > 1 && (
        <p className="editor-note">
          This shows the first of {count} scenarios.{' '}
          <Button variant="text" size="sm" onClick={openSetup}>
            Edit all scenarios in Run setup
          </Button>
        </p>
      )}
    </Card>
  );
}
