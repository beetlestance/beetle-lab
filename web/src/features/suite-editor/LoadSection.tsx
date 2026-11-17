import { useState } from 'react';
import type { Config } from '../suites/draft.js';
import { Button } from '../../components/Button.js';
import { Card, TextField } from './fields.js';
import { LoadChart } from './LoadChart.js';
import { executors, loadShape, rampHoldDrain } from './load.js';
import { firstScenario, isObj, list, setScenario, text } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { ExecutorSelect, ScenarioFields } from './ScenarioFields.js';

/** "About": the target the revision tests. Name, folder and description are suite metadata, edited separately. */
export function AboutSection({ config, set }: { config: Config; set: SetConfig }) {
  return (
    <Card title="About">
      <TextField
        label="Target URL"
        path="/target"
        value={config.target}
        hint="Base URL of the service under test. Request paths are added to it."
        change={(target) => set({ ...config, target })}
      />
    </Card>
  );
}

const vuExecutors = new Set(['ramping-vus', 'constant-vus']);
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
  const shape = loadShape(scenario);
  const hint = executors.find((item) => item.id === scenario.executor)?.hint;
  const unit = vuExecutors.has(text(scenario.executor)) ? 'virtual users' : 'requests a second';
  const change = (next: Obj) => set(setScenario(config, 0, next));
  return (
    <Card title="How load arrives">
      <ExecutorSelect scenario={scenario} path="/loadPlan/scenarios/0" set={change} />
      {hint && <p className="editor-note">{hint}</p>}
      <ScenarioFields scenario={scenario} path="/loadPlan/scenarios/0" simple={simple} set={change} />
      {shape && <LoadChart shape={shape} unit={unit} />}
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
