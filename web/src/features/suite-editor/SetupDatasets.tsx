import { useState } from 'react';
import { Button } from '../../components/Button.js';
import { Select } from '../../components/Fields.js';
import { formatDraft, parseDraft } from '../suites/draft.js';
import type { Config } from '../suites/draft.js';
import { Card, TextField, WholeField } from './fields.js';
import type { InputCatalog } from './fields.js';
import { inputRef, isObj, list, objects, text, uniqueId, without } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { fieldId } from './problems.js';

function sourceFor(value: string, dataset: Obj, inputs: InputCatalog): Obj | null {
  const base = { id: dataset.id, selection: dataset.selection };
  if (value === 'inline') return { ...base, kind: 'inline', rows: [{ value: '' }] };
  if (value === 'range') return { ...base, kind: 'range', column: 'id', start: 1, end: 10000, step: 1 };
  const file = inputs.choices.find((input) => input.id.toLowerCase() === value);
  return file
    ? { ...base, kind: file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv', input: inputRef(file) }
    : null;
}
/** Raw invalid rows stay in the unsaved draft as an invalid rows type; they cannot silently save as older values. */
function InlineRows({ dataset, index, change }: { dataset: Obj; index: number; change: (dataset: Obj) => void }) {
  const [raw, setRaw] = useState(() =>
    typeof dataset.rows === 'string' ? dataset.rows : formatDraft(dataset.rows ?? []),
  );
  return (
    <div className="field">
      <label className="field-label" htmlFor={fieldId(`/datasets/${index}/rows`)}>
        Dataset {index + 1} rows (JSON array)
      </label>
      <textarea
        id={fieldId(`/datasets/${index}/rows`)}
        className="input code-input"
        spellCheck={false}
        aria-invalid={!Array.isArray(dataset.rows)}
        maxLength={1_048_576}
        value={raw}
        onChange={(event) => {
          const next = event.target.value;
          setRaw(next);
          try {
            change({ ...dataset, rows: parseDraft(`{"rows":${next}}`).rows });
          } catch {
            change({ ...dataset, rows: next });
          }
        }}
      />
      {!Array.isArray(dataset.rows) && (
        <p className="field-error" role="alert">
          Enter a valid JSON array. Your unfinished text is kept and cannot be saved.
        </p>
      )}
      <p className="editor-note">
        Use 1–10,000 objects with the same columns and text, number, true, false or null values.
      </p>
    </div>
  );
}
function RangeFields({ dataset, index, change }: { dataset: Obj; index: number; change: (dataset: Obj) => void }) {
  const prefix = `/datasets/${index}`;
  return (
    <div className="field-row four">
      <TextField
        label={`Dataset ${index + 1} column`}
        path={`${prefix}/column`}
        maxLength={64}
        value={dataset.column}
        change={(column) => change({ ...dataset, column })}
      />
      {(['start', 'end', 'step'] as const).map((key) => (
        <WholeField
          key={key}
          label={`Dataset ${index + 1} ${key}`}
          path={`${prefix}/${key}`}
          value={dataset[key]}
          change={(value) => change({ ...dataset, [key]: value })}
        />
      ))}
    </div>
  );
}
const inlineRowsLabel = (dataset: Obj) => `Typed here: ${Array.isArray(dataset.rows) ? dataset.rows.length : 0} rows`;
function DatasetEntry({
  dataset,
  index,
  inputs,
  change,
  remove,
}: {
  dataset: Obj;
  index: number;
  inputs: InputCatalog;
  change: (dataset: Obj) => void;
  remove: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const prefix = `/datasets/${index}`;
  const fileId = isObj(dataset.input) ? text(dataset.input.id).toLowerCase() : '';
  const files = inputs.choices.filter((input) => /\.(csv|json)$/i.test(input.name));
  const current = fileId || text(dataset.kind);
  const missing = fileId && !files.some((file) => file.id.toLowerCase() === fileId);
  return (
    <li className="setup-dataset-entry" id={fieldId(prefix)} tabIndex={-1}>
      <div className="field-row setup-dataset-fields">
        <TextField
          label={`Dataset ${index + 1} name`}
          path={`${prefix}/id`}
          value={dataset.id}
          maxLength={64}
          change={(id) => change({ ...dataset, id })}
        />
        <Select
          label={`Dataset ${index + 1} rows from`}
          id={fieldId(`${prefix}/input`)}
          value={current}
          onChange={(event) => {
            const next = sourceFor(event.target.value, dataset, inputs);
            if (next) change(next);
          }}
        >
          {missing && <option value={fileId}>{inputs.name(fileId) ?? 'Referenced input'} (not available)</option>}
          {files.map((file) => (
            <option key={file.id} value={file.id.toLowerCase()}>
              {file.name.toLowerCase().endsWith('.json') ? 'JSON' : 'CSV'} input: {file.name}
            </option>
          ))}
          <option value="inline">{inlineRowsLabel(dataset)}</option>
          <option value="range">Number range</option>
        </Select>
        <Select
          label={`Dataset ${index + 1} each virtual user gets`}
          id={fieldId(`${prefix}/selection`)}
          value={text(dataset.selection)}
          onChange={(event) => change({ ...dataset, selection: event.target.value })}
        >
          <option value="byVu">Its own row</option>
          <option value="random">A random row</option>
        </Select>
        {dataset.kind === 'inline' && (
          <Button variant="text" aria-expanded={editing} onClick={() => setEditing(!editing)}>
            Edit rows
          </Button>
        )}
        <Button variant="text" aria-label={`Remove dataset ${index + 1}`} onClick={remove}>
          Remove
        </Button>
      </div>
      {dataset.kind === 'inline' && editing && <InlineRows dataset={dataset} index={index} change={change} />}
      {dataset.kind === 'range' && <RangeFields dataset={dataset} index={index} change={change} />}
    </li>
  );
}
export function SetupDatasets({ config, set, inputs }: { config: Config; set: SetConfig; inputs: InputCatalog }) {
  const datasets = list(config.datasets);
  const replace = (position: number, value: Obj) =>
    set({ ...config, datasets: datasets.map((dataset, index) => (index === position ? value : dataset)) });
  const add = () => {
    const id = uniqueId(
      'data',
      objects(datasets).map((dataset) => text(dataset.id)),
    );
    set({ ...config, datasets: [...datasets, { id, kind: 'inline', selection: 'byVu', rows: [{ value: '' }] }] });
  };
  return (
    <Card
      title="Datasets"
      action={
        <Button variant="text" disabled={datasets.length >= 64} onClick={add}>
          Add dataset
        </Button>
      }
    >
      <p className="editor-note">{'Rows that requests read as {{data.<dataset>.<column>}}.'}</p>
      <ol className="editor-list">
        {datasets.map((dataset, index) =>
          isObj(dataset) ? (
            <DatasetEntry
              key={index}
              dataset={dataset}
              index={index}
              inputs={inputs}
              change={(value) => replace(index, value)}
              remove={() => set({ ...config, datasets: without(datasets, index) })}
            />
          ) : null,
        )}
      </ol>
      <p className="editor-note">
        Rows can also come from a JSON input or a number range, for example ids 1 to 10,000 in steps of 1.
      </p>
    </Card>
  );
}
