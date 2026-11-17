import { Button } from '../../components/Button.js';
import { Checkbox, Select } from '../../components/Fields.js';
import type { Config } from '../suites/draft.js';
import { Card, TextField, WholeField } from './fields.js';
import { switchExecutor } from './load.js';
import { isObj, list, objects, setEntry, setScenario, text, uniqueId } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { ExecutorSelect, ScenarioFields } from './ScenarioFields.js';

/** "Suite / Edit / Run setup": every scenario, the request mix, readiness and target sampling. */
export function RunSetup({ config, set }: { config: Config; set: SetConfig }) {
  return (
    <>
      <Scenarios config={config} set={set} />
      <RequestMix config={config} set={set} />
      <Readiness config={config} set={set} />
      <Sampling config={config} set={set} />
    </>
  );
}

function Scenarios({ config, set }: { config: Config; set: SetConfig }) {
  const plan = isObj(config.loadPlan) ? config.loadPlan : { version: 1, scenarios: [], slos: [] };
  const scenarios = list(plan.scenarios);
  function add() {
    const taken = objects(scenarios).map((item) => text(item.id));
    const id = uniqueId('scenario', taken);
    const scenario = switchExecutor(
      { id, name: id, startTime: '0s', gracefulStop: '30s', vus: 10 },
      'constant-arrival-rate',
    );
    let next: Config = { ...config, loadPlan: { ...plan, scenarios: [...scenarios, scenario] } };
    for (const request of objects(config.requests)) next = setEntry(next, id, text(request.id), {});
    set(next);
  }
  function remove(index: number) {
    const removed = objects(scenarios)[index];
    set({
      ...config,
      loadPlan: { ...plan, scenarios: scenarios.filter((_, at) => at !== index) },
      selections: objects(config.selections).filter((selection) => selection.scenarioId !== removed?.id),
    });
  }
  return (
    <Card
      title={`Scenarios (${scenarios.length} of 64)`}
      action={
        <Button variant="text" disabled={scenarios.length >= 64} onClick={add}>
          Add scenario
        </Button>
      }
    >
      <ol className="editor-list">
        {scenarios.map((scenario, index) => {
          if (!isObj(scenario)) return null;
          const path = `/loadPlan/scenarios/${index}`;
          const change = (next: Obj) => set(setScenario(config, index, next));
          return (
            <li key={index} className="scenario-block">
              <div className="field-row four">
                <TextField
                  label={`Scenario ${index + 1} name`}
                  path={`${path}/name`}
                  value={scenario.name}
                  maxLength={64}
                  change={(name) => change({ ...scenario, name })}
                />
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
              </div>
              <ScenarioFields scenario={scenario} path={path} set={change} simple={false} />
              <Button variant="text" size="sm" disabled={scenarios.length <= 1} onClick={() => remove(index)}>
                Remove scenario {index + 1}
              </Button>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

function MixRow({
  entry,
  path,
  label,
  edit,
  replace,
}: {
  entry: Obj;
  path: string;
  label: string;
  edit: (patch: Obj) => void;
  replace: (entry: Obj) => void;
}) {
  const wait = isObj(entry.wait) ? entry.wait : {};
  return (
    <div className="field-row mix-row">
      <p className="mix-name">{label}</p>
      <WholeField
        label={`${label} weight`}
        path={`${path}/weight`}
        value={entry.weight}
        change={(weight) => edit({ weight })}
      />
      <WholeField
        label="Wait, ms"
        path={`${path}/wait/durationMs`}
        value={wait.durationMs}
        change={(durationMs) => edit({ wait: { ...wait, durationMs } })}
      />
      <WholeField
        label="Jitter, ms"
        path={`${path}/wait/jitterMs`}
        value={wait.jitterMs}
        change={(jitterMs) => edit({ wait: { ...wait, jitterMs } })}
      />
      <WholeField
        label="Limit per virtual user"
        path={`${path}/maxIterationsPerVu`}
        value={entry.maxIterationsPerVu}
        hint="Empty means no limit"
        change={(limit) => {
          if (limit !== '') return edit({ maxIterationsPerVu: limit });
          const rest = { ...entry };
          delete rest.maxIterationsPerVu;
          replace(rest);
        }}
      />
    </div>
  );
}

function ScenarioMix({
  config,
  set,
  scenario,
  index,
  name,
}: {
  config: Config;
  set: SetConfig;
  scenario: Obj;
  index: number;
  name: (id: unknown) => string;
}) {
  const requests = objects(config.requests);
  const scenarioId = text(scenario.id);
  const selections = objects(config.selections);
  const selectionIndex = selections.findIndex((item) => item.scenarioId === scenarioId);
  const entries = objects(selections[selectionIndex]?.entries);
  const missing = requests.filter((request) => !entries.some((entry) => entry.requestId === request.id));
  const edit = (requestId: string, patch: Obj) => set(setEntry(config, scenarioId, requestId, patch));
  const replace = (position: number, entry: Obj) =>
    set({
      ...config,
      selections: selections.map((selection, at) =>
        at === selectionIndex
          ? { ...selection, entries: entries.map((item, i) => (i === position ? entry : item)) }
          : selection,
      ),
    });
  return (
    <fieldset className="editor-rows">
      <legend>{text(scenario.name, `Scenario ${index + 1}`)}</legend>
      {entries.map((entry, position) => (
        <MixRow
          key={position}
          entry={entry}
          path={`/selections/${selectionIndex}/entries/${position}`}
          label={name(entry.requestId)}
          edit={(patch) => edit(text(entry.requestId), patch)}
          replace={(next) => replace(position, next)}
        />
      ))}
      {missing.length > 0 && (
        <Select
          label={`Add a request to ${text(scenario.name, 'this scenario')}`}
          value=""
          placeholder="Choose a request"
          onChange={(event) => edit(event.target.value, {})}
        >
          {missing.map((request) => (
            <option key={text(request.id)} value={text(request.id)}>
              {name(request.id)}
            </option>
          ))}
        </Select>
      )}
    </fieldset>
  );
}

function RequestMix({ config, set }: { config: Config; set: SetConfig }) {
  const requests = objects(config.requests);
  const name = (id: unknown) => {
    const request = requests.find((item) => item.id === id);
    return request ? `${text(request.method)} ${text(request.path)}` : text(id, 'Unknown request');
  };
  const scenarios = objects(isObj(config.loadPlan) ? config.loadPlan.scenarios : []);
  return (
    <Card title="Request mix">
      <p className="editor-note">
        Weights set how often each request is picked. Wait adds a pause after it, plus up to the jitter at random.
      </p>
      {scenarios.map((scenario, index) => (
        <ScenarioMix key={index} config={config} set={set} scenario={scenario} index={index} name={name} />
      ))}
    </Card>
  );
}

function Readiness({ config, set }: { config: Config; set: SetConfig }) {
  const probe = isObj(config.readiness) ? config.readiness : null;
  const change = (patch: Obj) => set({ ...config, readiness: { ...probe, ...patch } });
  return (
    <Card title="Readiness probe">
      <Checkbox
        label="Wait until the target answers before starting load"
        checked={!!probe}
        onChange={(event) => {
          const next = { ...config };
          if (event.target.checked)
            next.readiness = {
              path: '/health',
              attempts: 10,
              intervalMs: 1000,
              timeoutMs: 2000,
              wallBudgetMs: 30000,
              expectedStatus: 200,
              assertions: [],
            };
          else delete next.readiness;
          set(next);
        }}
      />
      {probe && (
        <div className="field-row four">
          <TextField label="Probe path" path="/readiness/path" value={probe.path} change={(path) => change({ path })} />
          <WholeField
            label="Expected status"
            path="/readiness/expectedStatus"
            value={probe.expectedStatus}
            change={(expectedStatus) => change({ expectedStatus })}
          />
          <WholeField
            label="Attempts"
            path="/readiness/attempts"
            value={probe.attempts}
            change={(attempts) => change({ attempts })}
          />
          <WholeField
            label="Between attempts, ms"
            path="/readiness/intervalMs"
            value={probe.intervalMs}
            change={(intervalMs) => change({ intervalMs })}
          />
          <WholeField
            label="Attempt timeout, ms"
            path="/readiness/timeoutMs"
            value={probe.timeoutMs}
            change={(timeoutMs) => change({ timeoutMs })}
          />
          <WholeField
            label="Give up after, ms"
            path="/readiness/wallBudgetMs"
            value={probe.wallBudgetMs}
            change={(wallBudgetMs) => change({ wallBudgetMs })}
          />
        </div>
      )}
    </Card>
  );
}

function Sampling({ config, set }: { config: Config; set: SetConfig }) {
  const sampling = isObj(config.targetSampling) ? config.targetSampling : null;
  const change = (patch: Obj) => set({ ...config, targetSampling: { ...sampling, ...patch } });
  return (
    <Card title="Target sampling">
      <Checkbox
        label="Read the target's process stats during the run"
        hint="The target must serve them, for example at /debug/process."
        checked={!!sampling}
        onChange={(event) => {
          const next = { ...config };
          if (event.target.checked)
            next.targetSampling = { path: '/debug/process', intervalMs: 5000, timeoutMs: 1000, cooldownMs: 10000 };
          else delete next.targetSampling;
          set(next);
        }}
      />
      {sampling && (
        <div className="field-row four">
          <TextField
            label="Stats path"
            path="/targetSampling/path"
            value={sampling.path}
            change={(path) => change({ path })}
          />
          <WholeField
            label="Read every, ms"
            path="/targetSampling/intervalMs"
            value={sampling.intervalMs}
            hint="1,000 to 60,000"
            change={(intervalMs) => change({ intervalMs })}
          />
          <WholeField
            label="Read timeout, ms"
            path="/targetSampling/timeoutMs"
            value={sampling.timeoutMs}
            hint="100 to 5,000"
            change={(timeoutMs) => change({ timeoutMs })}
          />
          <WholeField
            label="Keep reading after load, ms"
            path="/targetSampling/cooldownMs"
            value={sampling.cooldownMs}
            hint="0 to 60,000"
            change={(cooldownMs) => change({ cooldownMs })}
          />
        </div>
      )}
    </Card>
  );
}
