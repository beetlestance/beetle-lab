import { Button } from '../../components/Button.js';
import { Select } from '../../components/Fields.js';
import { TextField, WholeField } from './fields.js';
import { executors, setRampHoldDrain, switchExecutor } from './load.js';
import { isObj, numberOrRaw, objects, without } from './model.js';
import type { Obj } from './model.js';
import { fieldId } from './problems.js';

const labels: Record<string, string> = {
  rate: 'Requests per time unit',
  startRate: 'Starting rate',
  maxRate: 'Top rate',
  stepRate: 'Rate step',
  stepDuration: 'Step length',
  timeUnit: 'Time unit',
  duration: 'Duration',
  maxDuration: 'Longest duration',
  preAllocatedVUs: 'Virtual users ready at start',
  maxVUs: 'Most virtual users',
  vus: 'Virtual users',
  startVUs: 'Starting virtual users',
  iterations: 'Iterations',
  gracefulRampDown: 'Graceful ramp-down',
};
const wholeKeys = new Set([
  'rate',
  'startRate',
  'maxRate',
  'stepRate',
  'preAllocatedVUs',
  'maxVUs',
  'vus',
  'startVUs',
  'iterations',
]);
const order = Object.keys(labels);

export function ExecutorSelect({ scenario, path, set }: { scenario: Obj; path: string; set: (next: Obj) => void }) {
  const known = executors.some((item) => item.id === scenario.executor);
  return (
    <Select
      id={fieldId(`${path}/executor`)}
      label="Executor"
      value={typeof scenario.executor === 'string' ? scenario.executor : ''}
      onChange={(event) => set(switchExecutor(scenario, event.target.value))}
    >
      {!known && <option value={String(scenario.executor ?? '')}>Unknown executor</option>}
      {executors.map((item) => (
        <option key={item.id} value={item.id}>
          {item.label}
        </option>
      ))}
    </Select>
  );
}

const secondsText = (value: unknown) => {
  const raw = typeof value === 'string' ? value : '';
  return /^[0-9]+s$/.test(raw) ? Number(raw.slice(0, -1)) : raw;
};

/** Peak, ramp-up, hold and drain of a three-stage ramp, in whole seconds. */
function RampHoldDrain({ scenario, path, set }: { scenario: Obj; path: string; set: (next: Obj) => void }) {
  const stages = objects(scenario.stages);
  const edit = (field: 'peak' | 'ramp' | 'hold' | 'drain') => (value: number | string) =>
    set(setRampHoldDrain(scenario, field, value));
  const unit = scenario.executor === 'ramping-vus' ? 'Peak virtual users' : 'Peak requests a second';
  return (
    <>
      <div className="field-row four">
        <WholeField label={unit} path={`${path}/stages/0/target`} value={stages[0]!.target} change={edit('peak')} />
        <WholeField
          label="Ramp-up, seconds"
          path={`${path}/stages/0/duration`}
          value={secondsText(stages[0]!.duration)}
          change={edit('ramp')}
        />
        <WholeField
          label="Hold, seconds"
          path={`${path}/stages/1/duration`}
          value={secondsText(stages[1]!.duration)}
          change={edit('hold')}
        />
        <WholeField
          label="Drain, seconds"
          path={`${path}/stages/2/duration`}
          value={secondsText(stages[2]!.duration)}
          change={edit('drain')}
        />
      </div>
      {'maxVUs' in scenario && (
        <div className="field-row four">
          <WholeField
            label="Most virtual users"
            path={`${path}/maxVUs`}
            value={scenario.maxVUs}
            change={(value) => set({ ...scenario, maxVUs: value })}
          />
        </div>
      )}
    </>
  );
}

/**
 * Executor parameters of one scenario. `simple` shows the ramp/hold/drain view; the caller decides it once
 * (from `rampHoldDrain`) so a half-typed value does not swap the layout under the cursor.
 */
const hasScenarioFields = (keys: readonly string[], stages: boolean, scenario: Obj) =>
  keys.length > 0 || stages || isObj(scenario.stopRule);
export function ScenarioFields({
  scenario,
  path,
  set,
  simple,
  omit,
  hideStages = false,
}: {
  scenario: Obj;
  path: string;
  set: (next: Obj) => void;
  simple: boolean;
  omit?: ReadonlySet<string> | undefined;
  hideStages?: boolean;
}) {
  if (simple && objects(scenario.stages).length === 3)
    return <RampHoldDrain scenario={scenario} path={path} set={set} />;
  const keys = order.filter((key) => key in scenario && !omit?.has(key));
  const stages = !hideStages && Array.isArray(scenario.stages);
  if (!hasScenarioFields(keys, stages, scenario)) return null;
  return (
    <>
      {keys.length > 0 && (
        <div className="field-row four">
          {keys.map((key) =>
            wholeKeys.has(key) ? (
              <WholeField
                key={key}
                label={labels[key]!}
                path={`${path}/${key}`}
                value={scenario[key]}
                change={(value) => set({ ...scenario, [key]: value })}
              />
            ) : (
              <TextField
                key={key}
                label={labels[key]!}
                path={`${path}/${key}`}
                value={scenario[key]}
                maxLength={12}
                hint="For example 30s or 5m"
                change={(value) => set({ ...scenario, [key]: value })}
              />
            ),
          )}
        </div>
      )}
      {stages && <Stages scenario={scenario} path={path} set={set} />}
      {isObj(scenario.stopRule) && (
        <StopRule
          rule={scenario.stopRule}
          path={`${path}/stopRule`}
          set={(stopRule) => set({ ...scenario, stopRule })}
        />
      )}
    </>
  );
}

function Stages({ scenario, path, set }: { scenario: Obj; path: string; set: (next: Obj) => void }) {
  const stages = objects(scenario.stages);
  const target = scenario.executor === 'ramping-vus' ? 'Virtual users' : 'Target rate';
  const update = (index: number, patch: Obj) =>
    set({
      ...scenario,
      stages: stages.map((stage, position) => (position === index ? { ...stage, ...patch } : stage)),
    });
  return (
    <fieldset className="editor-rows" id={fieldId(`${path}/stages`)} tabIndex={-1}>
      <legend>Stages</legend>
      {stages.map((stage, index) => (
        <div className="field-row stage-row" key={index}>
          <TextField
            label={`Stage ${index + 1} duration`}
            path={`${path}/stages/${index}/duration`}
            value={stage.duration}
            maxLength={12}
            change={(duration) => update(index, { duration })}
          />
          <WholeField
            label={`Stage ${index + 1} ${target.toLowerCase()}`}
            path={`${path}/stages/${index}/target`}
            value={stage.target}
            change={(value) => update(index, { target: value })}
          />
          <Button
            variant="text"
            size="sm"
            disabled={stages.length <= 1}
            onClick={() => set({ ...scenario, stages: without(scenario.stages, index) })}
          >
            Remove stage {index + 1}
          </Button>
        </div>
      ))}
      <Button
        variant="text"
        size="sm"
        disabled={stages.length >= 128}
        onClick={() =>
          set({ ...scenario, stages: [...stages, { duration: '60s', target: stages.at(-1)?.target ?? 1 }] })
        }
      >
        Add stage
      </Button>
    </fieldset>
  );
}

const stats = ['avg', 'min', 'max', 'med', 'p50', 'p90', 'p95', 'p99', 'count', 'rate', 'value'];
function StopRule({ rule, path, set }: { rule: Obj; path: string; set: (next: Obj) => void }) {
  return (
    <div className="field-row four">
      <TextField
        label="Stop when metric"
        path={`${path}/metric`}
        value={rule.metric}
        maxLength={64}
        change={(metric) => set({ ...rule, metric })}
      />
      <Select
        label="Statistic"
        id={fieldId(`${path}/stat`)}
        value={String(rule.stat ?? '')}
        onChange={(event) => set({ ...rule, stat: event.target.value })}
      >
        {stats.map((stat) => (
          <option key={stat}>{stat}</option>
        ))}
      </Select>
      <Select
        label="Is"
        id={fieldId(`${path}/operator`)}
        value={String(rule.operator ?? '')}
        onChange={(event) => set({ ...rule, operator: event.target.value })}
      >
        {['>', '>=', '<', '<='].map((operator) => (
          <option key={operator}>{operator}</option>
        ))}
      </Select>
      <TextField
        label="Value"
        path={`${path}/value`}
        value={rule.value}
        maxLength={20}
        change={(value) => set({ ...rule, value: numberOrRaw(value) })}
      />
    </div>
  );
}
