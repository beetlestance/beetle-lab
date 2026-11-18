import { useState } from 'react';
import { Button } from '../../components/Button.js';
import { TextInput } from '../../components/Fields.js';
import type { Config } from '../suites/draft.js';
import { Card, TextField, WholeField } from './fields.js';
import { switchExecutor } from './load.js';
import { isObj, list, objects, setEntry, setScenario, text, uniqueId } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { fieldId } from './problems.js';
import { ExecutorSelect, ScenarioFields } from './ScenarioFields.js';

const arrival = new Set(['constant-arrival-rate', 'ramping-arrival-rate', 'ramp-until']);
const primaryKeys = new Set(['rate', 'startRate', 'timeUnit', 'preAllocatedVUs', 'maxVUs']);
function ScenarioName({
  scenario,
  index,
  total,
  change,
}: {
  scenario: Obj;
  index: number;
  total: number;
  change: (next: Obj) => void;
}) {
  const [editing, setEditing] = useState(false);
  const id = fieldId(`/loadPlan/scenarios/${index}/name`);
  return (
    <span className="scenario-name">
      Scenario:{' '}
      {editing ? (
        <TextInput
          id={id}
          label={`Scenario ${index + 1} name`}
          hideLabel
          autoFocus
          maxLength={64}
          value={text(scenario.name)}
          onChange={(event) => change({ ...scenario, name: event.target.value })}
          onBlur={() => setEditing(false)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') setEditing(false);
          }}
        />
      ) : (
        <button
          id={id}
          type="button"
          aria-label={`Rename scenario ${index + 1}: ${text(scenario.name)}`}
          onClick={() => setEditing(true)}
        >
          {text(scenario.name, 'Unnamed')}
        </button>
      )}
      <span className="scenario-count">
        {index + 1} of {total}
      </span>
    </span>
  );
}
function PrimaryFields({ scenario, path, change }: { scenario: Obj; path: string; change: (next: Obj) => void }) {
  const open = arrival.has(text(scenario.executor));
  const rate = scenario.executor === 'constant-arrival-rate' ? 'rate' : 'startRate';
  return (
    <>
      <div className="field-row scenario-primary">
        <ExecutorSelect scenario={scenario} path={path} set={change} />
        <TextField
          label="Starts after"
          path={`${path}/startTime`}
          value={scenario.startTime}
          maxLength={12}
          change={(startTime) => change({ ...scenario, startTime })}
        />
        <TextField
          label="Graceful stop"
          path={`${path}/gracefulStop`}
          value={scenario.gracefulStop}
          maxLength={12}
          change={(gracefulStop) => change({ ...scenario, gracefulStop })}
        />
        {open && (
          <WholeField
            label={rate === 'rate' ? 'Rate' : 'Start rate'}
            path={`${path}/${rate}`}
            value={scenario[rate]}
            change={(value) => change({ ...scenario, [rate]: value })}
          />
        )}
        {open && (
          <TextField
            label="Rate per"
            path={`${path}/timeUnit`}
            value={scenario.timeUnit}
            maxLength={12}
            change={(timeUnit) => change({ ...scenario, timeUnit })}
          />
        )}
      </div>
      {open && (
        <div className="field-row scenario-pool">
          <WholeField
            label="Virtual users ready at start"
            path={`${path}/preAllocatedVUs`}
            value={scenario.preAllocatedVUs}
            change={(preAllocatedVUs) => change({ ...scenario, preAllocatedVUs })}
          />
          <WholeField
            label="Most virtual users"
            path={`${path}/maxVUs`}
            value={scenario.maxVUs}
            change={(maxVUs) => change({ ...scenario, maxVUs })}
          />
        </div>
      )}
    </>
  );
}
/** The first scenario's stages are edited on the main form; additional scenarios retain their full stage editor here. */
export function SetupScenarios({ config, set }: { config: Config; set: SetConfig }) {
  const plan = isObj(config.loadPlan) ? config.loadPlan : { version: 1, scenarios: [], slos: [] };
  const scenarios = list(plan.scenarios);
  const add = () => {
    const id = uniqueId(
      'scenario',
      objects(scenarios).map((item) => text(item.id)),
    );
    const scenario = switchExecutor(
      { id, name: id, startTime: '0s', gracefulStop: '30s', vus: 10 },
      'constant-arrival-rate',
    );
    let next: Config = { ...config, loadPlan: { ...plan, scenarios: [...scenarios, scenario] } };
    for (const request of objects(config.requests)) next = setEntry(next, id, text(request.id), {});
    set(next);
  };
  const remove = (index: number) => {
    const removed = objects(scenarios)[index];
    set({
      ...config,
      loadPlan: { ...plan, scenarios: scenarios.filter((_, at) => at !== index) },
      selections: objects(config.selections).filter((selection) => selection.scenarioId !== removed?.id),
    });
  };
  return (
    <>
      {scenarios.map((scenario, index) => {
        if (!isObj(scenario)) return null;
        const path = `/loadPlan/scenarios/${index}`;
        const change = (value: Obj) => set(setScenario(config, index, value));
        return (
          <Card
            key={index}
            className="setup-scenario"
            title={<ScenarioName scenario={scenario} index={index} total={scenarios.length} change={change} />}
            action={
              <Button variant="text" disabled={scenarios.length >= 64} onClick={add}>
                Add scenario
              </Button>
            }
          >
            <p className="editor-note">
              A suite can run up to 64 scenarios side by side, each with its own executor and timing.
            </p>
            <PrimaryFields scenario={scenario} path={path} change={change} />
            <ScenarioFields
              scenario={scenario}
              path={path}
              set={change}
              simple={false}
              omit={arrival.has(text(scenario.executor)) ? primaryKeys : undefined}
              hideStages={index === 0}
            />
            {arrival.has(text(scenario.executor)) && (
              <p className="editor-note">
                If virtual users cannot keep up with the requested rate, k6 skips the missing requests and reports them
                as dropped.
              </p>
            )}
            {scenarios.length > 1 && (
              <Button variant="text" onClick={() => remove(index)}>
                Remove scenario {index + 1}
              </Button>
            )}
          </Card>
        );
      })}
    </>
  );
}
