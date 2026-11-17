import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import type { Config } from '../suites/draft.js';
import { Card } from './fields.js';
import type { InputCatalog } from './fields.js';
import { at, inputRef, isObj, list, objects, text, uniqueId, without } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { fieldId } from './problems.js';
import { presetOf, shownValue, storedValue, thresholdOperators, thresholdPresets } from './rules.js';

function setSlos(config: Config, slos: unknown[]): Config {
  const plan = isObj(config.loadPlan) ? config.loadPlan : { version: 1, scenarios: [] };
  return { ...config, loadPlan: { ...plan, slos } };
}

const unitSuffix = (preset: ReturnType<typeof presetOf>) =>
  preset?.percent ? ', percent' : preset ? ', milliseconds' : '';

function ThresholdRow({
  rule,
  index,
  change,
  remove,
}: {
  rule: Obj;
  index: number;
  change: (patch: Obj) => void;
  remove: () => void;
}) {
  const preset = presetOf(rule);
  const n = index + 1;
  const path = `/loadPlan/slos/${index}`;
  return (
    <li className="field-row threshold-row">
      <Select
        id={fieldId(`${path}/metric`)}
        label={`Threshold ${n} measure`}
        hideLabel
        value={preset?.id ?? 'custom'}
        onChange={(event) => {
          const next = thresholdPresets.find((item) => item.id === event.target.value);
          if (next) change({ metric: next.metric, stat: next.stat, value: next.percent ? 0.01 : 500 });
        }}
      >
        {!preset && <option value="custom">{`${text(rule.metric)} ${text(rule.stat)}`}</option>}
        {thresholdPresets.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>
      <Select
        id={fieldId(`${path}/operator`)}
        label={`Threshold ${n} comparison`}
        hideLabel
        value={text(rule.operator)}
        onChange={(event) => change({ operator: event.target.value })}
      >
        {thresholdOperators.map((item) => (
          <option key={item.id} value={item.id}>
            {item.label}
          </option>
        ))}
      </Select>
      <TextInput
        id={fieldId(`${path}/value`)}
        label={`Threshold ${n} value${unitSuffix(preset)}`}
        hideLabel
        inputMode="decimal"
        maxLength={20}
        value={shownValue(rule)}
        onChange={(event) => change({ value: storedValue(rule, event.target.value.trim()) })}
      />
      <Button variant="text" size="sm" aria-label={`Remove threshold ${n}`} onClick={remove}>
        Remove
      </Button>
    </li>
  );
}

/** "Pass only if": load-plan SLO rules, shown with friendly names for the common metrics. */
export function ThresholdsSection({ config, set }: { config: Config; set: SetConfig }) {
  const slos = isObj(config.loadPlan) ? list(config.loadPlan.slos) : [];
  const rules = slos.filter(isObj);
  const add = () =>
    set(
      setSlos(config, [
        ...slos,
        {
          id: uniqueId(
            'slo',
            rules.map((rule) => text(rule.id)),
          ),
          metric: 'http_req_duration',
          stat: 'p95',
          operator: '<',
          value: 500,
        },
      ]),
    );
  return (
    <Card
      title="Pass only if"
      action={
        <Button variant="text" disabled={slos.length >= 128} onClick={add}>
          Add threshold
        </Button>
      }
    >
      {!rules.length && (
        <p className="editor-note">No thresholds. The run passes whenever it completes and its required checks pass.</p>
      )}
      <ol className="editor-list">
        {slos.map((rule, index) =>
          isObj(rule) ? (
            <ThresholdRow
              key={index}
              rule={rule}
              index={index}
              change={(patch) => set(setSlos(config, at(slos, index, patch)))}
              remove={() => set(setSlos(config, without(slos, index)))}
            />
          ) : null,
        )}
      </ol>
    </Card>
  );
}

const fileKind = (name: string) => (name.endsWith('.json') ? 'json' : 'csv');

function DatasetRow({
  dataset,
  index,
  files,
  inputs,
  change,
  remove,
}: {
  dataset: Obj;
  index: number;
  files: InputCatalog['choices'];
  inputs: InputCatalog;
  change: (patch: Obj) => void;
  remove: () => void;
}) {
  const path = `/datasets/${index}`;
  const n = index + 1;
  const id = isObj(dataset.input) ? text(dataset.input.id).toLowerCase() : '';
  const listed = files.some((file) => file.id.toLowerCase() === id);
  return (
    <li className="field-row dataset-row">
      <Select
        id={fieldId(`${path}/input`)}
        label={`Dataset ${n} source`}
        hideLabel
        value={id || text(dataset.kind)}
        disabled={!id}
        onChange={(event) => {
          const file = files.find((item) => item.id.toLowerCase() === event.target.value);
          if (file) change({ kind: fileKind(file.name), input: inputRef(file) });
        }}
      >
        {!id && (
          <option value={text(dataset.kind)}>
            {dataset.kind === 'range' ? 'Number range' : 'Inline rows'} ({text(dataset.id)})
          </option>
        )}
        {id && !listed && <option value={id}>{inputs.name(id) ?? `Input ${id.slice(0, 8)}`} (not available)</option>}
        {files.map((file) => (
          <option key={file.id} value={file.id.toLowerCase()}>
            {file.name}
          </option>
        ))}
      </Select>
      <Select
        id={fieldId(`${path}/selection`)}
        label={`Dataset ${n} row choice`}
        hideLabel
        value={text(dataset.selection)}
        onChange={(event) => change({ selection: event.target.value })}
      >
        <option value="byVu">One row per virtual user</option>
        <option value="random">A random row each iteration</option>
      </Select>
      <Button variant="text" size="sm" aria-label={`Remove dataset ${n}`} onClick={remove}>
        Remove
      </Button>
    </li>
  );
}

export function DatasetsSection({ config, set, inputs }: { config: Config; set: SetConfig; inputs: InputCatalog }) {
  const datasets = list(config.datasets);
  const files = inputs.choices.filter((choice) => /\.(csv|json)$/i.test(choice.name));
  const taken = objects(config.datasets).map((item) => text(item.id));
  const add = () => {
    const file = files[0]!;
    set({
      ...config,
      datasets: [
        ...datasets,
        { id: uniqueId(file.name, taken), selection: 'byVu', kind: fileKind(file.name), input: inputRef(file) },
      ],
    });
  };
  return (
    <Card
      title="Datasets"
      action={
        <Button variant="text" disabled={!files.length || datasets.length >= 64} onClick={add}>
          Add dataset
        </Button>
      }
    >
      {!datasets.length && (
        <p className="editor-note">
          No datasets.{' '}
          {files.length
            ? 'Add one to feed rows from a CSV or JSON input into requests.'
            : 'Publish a CSV or JSON input first.'}
        </p>
      )}
      <ol className="editor-list">
        {datasets.map((dataset, index) =>
          isObj(dataset) ? (
            <DatasetRow
              key={index}
              dataset={dataset}
              index={index}
              files={files}
              inputs={inputs}
              change={(patch) => set({ ...config, datasets: at(datasets, index, patch) })}
              remove={() => set({ ...config, datasets: without(datasets, index) })}
            />
          ) : null,
        )}
      </ol>
    </Card>
  );
}
