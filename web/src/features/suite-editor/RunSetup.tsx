import { Select } from '../../components/Fields.js';
import type { Config } from '../suites/draft.js';
import { SetupDatasets } from './SetupDatasets.js';
import type { InputCatalog } from './fields.js';
import { Card, SecondsField, TextField, WholeField } from './fields.js';
import { SetupScenarios } from './SetupScenarios.js';
import { isObj, objects, setEntry, text } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { OptionalTitle } from './OptionalTitle.js';
import { SecretsSection } from './SecretsSection.js';

/** "Suite / Edit / Run setup": every scenario, the request mix, readiness and target sampling. */
export function RunSetup({ config, set, inputs }: { config: Config; set: SetConfig; inputs: InputCatalog }) {
  return (
    <>
      <SetupScenarios config={config} set={set} />
      <RequestMix config={config} set={set} />
      <Readiness config={config} set={set} />
      <Sampling config={config} set={set} />
      <SecretsSection config={config} set={set} />
      <SetupDatasets config={config} set={set} inputs={inputs} />
    </>
  );
}

function MixRow({
  entry,
  path,
  label,
  edit,
  replace,
  share,
}: {
  entry: Obj;
  path: string;
  label: string;
  edit: (patch: Obj) => void;
  replace: (entry: Obj) => void;
  share: string;
}) {
  const wait = isObj(entry.wait) ? entry.wait : {};
  return (
    <div className="field-row mix-row">
      <p className="mix-name">{label}</p>
      <WholeField
        label={
          <>
            <span className="sr-only">{label} </span>Weight
          </>
        }
        path={`${path}/weight`}
        value={entry.weight}
        change={(weight) => edit({ weight })}
      />
      <p className="mix-share" aria-label={`${label} share`}>
        {share}
      </p>
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
        placeholder="No limit"
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
  const total = entries.reduce(
    (sum, entry) => (typeof entry.weight === 'number' && entry.weight > 0 ? sum + entry.weight : NaN),
    0,
  );
  const share = (entry: Obj) =>
    Number.isFinite(total) && total > 0 && typeof entry.weight === 'number'
      ? `${Math.round((entry.weight / total) * 100)}%`
      : '—';
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
      <legend className="sr-only">{text(scenario.name, `Scenario ${index + 1}`)}</legend>
      {entries.map((entry, position) => (
        <MixRow
          key={position}
          entry={entry}
          path={`/selections/${selectionIndex}/entries/${position}`}
          label={name(entry.requestId)}
          share={share(entry)}
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
    <>
      {scenarios.map((scenario, index) => (
        <Card
          key={index}
          title={`Request mix for ${text(scenario.name, `Scenario ${index + 1}`)}`}
          className="request-mix-card"
        >
          <p className="editor-note">Each virtual user picks a request by weight, waits, then picks again.</p>
          <ScenarioMix config={config} set={set} scenario={scenario} index={index} name={name} />
        </Card>
      ))}
    </>
  );
}

function defaultProbe() {
  return {
    path: '/health',
    attempts: 10,
    intervalMs: 1000,
    timeoutMs: 2000,
    wallBudgetMs: 30000,
    expectedStatus: 200,
    assertions: [],
  };
}

function Readiness({ config, set }: { config: Config; set: SetConfig }) {
  const probe = isObj(config.readiness) ? config.readiness : null;
  const change = (patch: Obj) => set({ ...config, readiness: { ...probe, ...patch } });
  return (
    <Card
      className="setup-readiness"
      title={
        <OptionalTitle
          title="Wait until the target is ready"
          label="Wait until the target answers before starting load"
          enabled={!!probe}
          toggle={(enabled) => {
            const next = { ...config };
            if (enabled) next.readiness = defaultProbe();
            else delete next.readiness;
            set(next);
          }}
        />
      }
    >
      <p className="editor-note">
        Before any load, Beetle Lab calls this path until it answers. If it never does, the run stops without sending
        load.
      </p>
      {probe && (
        <div className="field-row readiness-fields">
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
          <SecondsField
            label={
              <>
                <span className="sr-only">Between attempts, seconds</span>
                <span aria-hidden="true">Every</span>
              </>
            }
            path="/readiness/intervalMs"
            value={probe.intervalMs}
            change={(intervalMs) => change({ intervalMs })}
          />
          <SecondsField
            label={
              <>
                <span className="sr-only">Attempt timeout, seconds</span>
                <span aria-hidden="true">Each attempt times out after</span>
              </>
            }
            path="/readiness/timeoutMs"
            value={probe.timeoutMs}
            change={(timeoutMs) => change({ timeoutMs })}
          />
          <SecondsField
            label={
              <>
                <span className="sr-only">Give up after, seconds</span>
                <span aria-hidden="true">Give up after</span>
              </>
            }
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
    <Card
      className="setup-sampling"
      title={
        <OptionalTitle
          title="Read the target’s own figures"
          label="Read the target's process stats during the run"
          enabled={!!sampling}
          toggle={(enabled) => {
            const next = { ...config };
            if (enabled)
              next.targetSampling = { path: '/debug/process', intervalMs: 5000, timeoutMs: 1000, cooldownMs: 10000 };
            else delete next.targetSampling;
            set(next);
          }}
        />
      }
    >
      <p className="editor-note">
        Polls a JSON endpoint on your service for heap, RSS, GC and event-loop figures before, during and after load.
        Shown under Target runtime on the result.
      </p>
      {sampling && (
        <div className="field-row four">
          <TextField
            label="Stats path"
            path="/targetSampling/path"
            value={sampling.path}
            change={(path) => change({ path })}
          />
          <SecondsField
            label="Read every, seconds"
            path="/targetSampling/intervalMs"
            value={sampling.intervalMs}
            hint="1 to 60 seconds"
            change={(intervalMs) => change({ intervalMs })}
          />
          <WholeField
            label="Read timeout, ms"
            path="/targetSampling/timeoutMs"
            value={sampling.timeoutMs}
            hint="100 to 5,000"
            change={(timeoutMs) => change({ timeoutMs })}
          />
          <SecondsField
            label="Keep reading after load, seconds"
            path="/targetSampling/cooldownMs"
            value={sampling.cooldownMs}
            hint="0 to 60 seconds"
            change={(cooldownMs) => change({ cooldownMs })}
          />
        </div>
      )}
      {sampling && (
        <p className="editor-note sampling-limit">
          At most 256 readings are kept per run, including before and after load. For a longer run, read less often.
        </p>
      )}
    </Card>
  );
}
