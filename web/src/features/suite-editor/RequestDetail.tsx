import { useState } from 'react';
import { Button } from '../../components/Button.js';
import { Select } from '../../components/Fields.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import type { Config } from '../suites/draft.js';
import { draftText, parseDraft } from '../suites/draft.js';
import { Card, TextField } from './fields.js';
import type { InputCatalog } from './fields.js';
import { isObj, methods, objects, text, uniqueId } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { fieldId } from './problems.js';
import { BodySelect, setRequest } from './RequestsSection.js';
import { Checks } from './RequestChecks.js';

function RequestHead({ request, path, change }: { request: Obj; path: string; change: (next: Obj) => void }) {
  return (
    <div className="field-row request-head">
      <TextField
        label="Name"
        path={`${path}/name`}
        value={request.name}
        maxLength={128}
        change={(name) => change({ ...request, name })}
      />
      <Select
        id={fieldId(`${path}/method`)}
        label="Method"
        value={text(request.method)}
        onChange={(event) => change({ ...request, method: event.target.value })}
      >
        {methods.map((method) => (
          <option key={method}>{method}</option>
        ))}
      </Select>
      <TextField
        label="Path"
        path={`${path}/path`}
        value={request.path}
        change={(value) => change({ ...request, path: value })}
      />
    </div>
  );
}

/** "Suite / Edit / Request": every field of one request. */
export function RequestDetail({
  config,
  set,
  index,
  inputs,
  close,
}: {
  config: Config;
  set: SetConfig;
  index: number;
  inputs: InputCatalog;
  close: () => void;
}) {
  const request = objects(config.requests)[index];
  if (!request)
    return (
      <Card
        title="Request"
        action={
          <Button variant="text" onClick={close}>
            Back to all requests
          </Button>
        }
      >
        <p className="editor-note">This request is no longer in the draft.</p>
      </Card>
    );
  const path = `/requests/${index}`;
  const change = (next: Obj) => set(setRequest(config, index, next));
  return (
    <Card
      title={`Request ${index + 1}: ${text(request.name, 'unnamed')}`}
      action={
        <Button variant="text" onClick={close}>
          Back to all requests
        </Button>
      }
    >
      <RequestHead request={request} path={path} change={change} />
      <Pairs
        title="Query parameters"
        path={`${path}/query`}
        value={request.query}
        change={(query) => change({ ...request, query })}
      />
      <Pairs
        title="Headers"
        path={`${path}/headers`}
        value={request.headers}
        hint="Put credentials in a secret and refer to it, for example {{secret.token}}."
        change={(headers) => change({ ...request, headers })}
      />
      <Body request={request} index={index} inputs={inputs} change={change} />
      <Checks request={request} path={path} change={change} />
      <Palette config={config} />
    </Card>
  );
}

function Pairs({
  title,
  path,
  value,
  change,
  hint,
}: {
  title: string;
  path: string;
  value: unknown;
  change: (value: Obj) => void;
  hint?: string;
}) {
  const entries = Object.entries(isObj(value) ? value : {});
  const write = (next: [string, unknown][]) => change(Object.fromEntries(next));
  const label = title.toLowerCase().replace(/s$/, '');
  return (
    <fieldset className="editor-rows" id={fieldId(path)} tabIndex={-1}>
      <legend>{title}</legend>
      {hint && <p className="editor-note">{hint}</p>}
      {entries.map(([key, item], position) => (
        <div className="field-row pair-row" key={position}>
          <TextField
            label={`${title} ${position + 1} name`}
            hideLabel
            path={`${path}/${position}/name`}
            value={key}
            maxLength={128}
            placeholder="Name"
            change={(name) => write(entries.map((entry, at) => (at === position ? [name, entry[1]] : entry)))}
          />
          <TextField
            label={`${title} ${position + 1} value`}
            hideLabel
            path={`${path}/${position}/value`}
            value={item}
            placeholder="Value"
            change={(next) => write(entries.map((entry, at) => (at === position ? [entry[0], next] : entry)))}
          />
          <Button
            variant="text"
            size="sm"
            aria-label={`Remove ${label} ${position + 1}`}
            onClick={() => write(entries.filter((_, at) => at !== position))}
          >
            Remove
          </Button>
        </div>
      ))}
      <Button
        variant="text"
        size="sm"
        disabled={entries.length >= 64}
        onClick={() =>
          write([
            ...entries,
            [
              uniqueId(
                label === 'header' ? 'x-header' : 'name',
                entries.map(([key]) => key),
              ),
              '',
            ],
          ])
        }
      >
        Add {label}
      </Button>
    </fieldset>
  );
}

function bodyFor(mode: string, inputs: InputCatalog): Obj | undefined {
  if (mode === 'inline') return { kind: 'json', value: {} };
  const choice = inputs.choices[0];
  if (mode !== 'input' || !choice) return undefined;
  return {
    kind: 'input',
    input: { id: choice.id, sha256: choice.sha256, bytes: choice.bytes },
    format: choice.name.endsWith('.json') ? 'json' : 'text',
  };
}

function InlineBody({ index, body, set }: { index: number; body: Obj | undefined; set: (value: unknown) => void }) {
  const [inline, setInline] = useState(() => (body?.kind === 'json' ? draftText(body.value ?? null) : '{}'));
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label className="field-label" htmlFor={`inline-body-${index}`}>
        Inline JSON body
      </label>
      <textarea
        id={`inline-body-${index}`}
        className="input code-input"
        spellCheck={false}
        value={inline}
        aria-invalid={error ? true : undefined}
        onChange={(event) => {
          setInline(event.target.value);
          try {
            const value = parseDraft(`{"value":${event.target.value}}`).value;
            setError('');
            set(value);
          } catch {
            setError('Not valid JSON yet. The draft keeps the last valid body until this parses.');
          }
        }}
      />
      {error && <small className="field-error">{error}</small>}
    </div>
  );
}

function InputBody({
  request,
  index,
  inputs,
  change,
}: {
  request: Obj;
  index: number;
  inputs: InputCatalog;
  change: (next: Obj) => void;
}) {
  const body = isObj(request.body) ? request.body : undefined;
  return (
    <>
      <div className="field-row">
        <BodySelect request={request} index={index} inputs={inputs} change={change} label="Input file" />
        <Select
          id={fieldId(`/requests/${index}/body/format`)}
          label="Read the file as"
          value={text(body?.format, 'text')}
          onChange={(event) => change({ ...request, body: { ...body, format: event.target.value } })}
        >
          <option value="text">Text, sent as is</option>
          <option value="json">JSON</option>
        </Select>
      </div>
      {!inputs.choices.length && !inputs.loading && (
        <p className="editor-note">No published input files in this workspace yet. Upload one on the Inputs page.</p>
      )}
    </>
  );
}

const bodyModes = { json: 'inline', input: 'input' } as Record<string, string>;

function Body({
  request,
  index,
  inputs,
  change,
}: {
  request: Obj;
  index: number;
  inputs: InputCatalog;
  change: (next: Obj) => void;
}) {
  const body = isObj(request.body) ? request.body : undefined;
  const mode = bodyModes[text(body?.kind)] ?? 'none';
  const rest = { ...request };
  delete rest.body;
  return (
    <fieldset className="editor-rows" id={fieldId(`/requests/${index}/body`)} tabIndex={-1}>
      <legend>Body</legend>
      <SegmentedFilter
        label="Body"
        value={mode}
        options={[
          { value: 'none', label: 'None' },
          { value: 'inline', label: 'Inline JSON' },
          { value: 'input', label: 'From input' },
        ]}
        onChange={(next) => {
          const value = bodyFor(next, inputs);
          if (next === 'none') change(rest);
          else if (value) change({ ...rest, body: value });
        }}
      />
      {mode === 'inline' && (
        <InlineBody index={index} body={body} set={(value) => change({ ...rest, body: { kind: 'json', value } })} />
      )}
      {mode === 'input' && <InputBody request={request} index={index} inputs={inputs} change={change} />}
      <p className="editor-note">
        Input files can be up to 8 MiB. Inline JSON counts toward the 1 MiB limit for the whole configuration.
      </p>
    </fieldset>
  );
}

function Palette({ config }: { config: Config }) {
  const values: string[] = [];
  let fromFiles = false;
  for (const secret of objects(config.secrets)) values.push(`{{secret.${text(secret.name)}}}`);
  for (const dataset of objects(config.datasets)) {
    const id = text(dataset.id);
    if (dataset.kind === 'range') values.push(`{{data.${id}.${text(dataset.column)}}}`);
    else if (dataset.kind === 'inline' && isObj(objects(dataset.rows)[0]))
      for (const column of Object.keys(objects(dataset.rows)[0]!).slice(0, 16)) values.push(`{{data.${id}.${column}}}`);
    else {
      values.push(`{{data.${id}.COLUMN}}`);
      fromFiles = true;
    }
  }
  if (!values.length) return null;
  return (
    <div className="value-palette">
      <p className="editor-note">Values you can use in the path, query, headers and checks:</p>
      <ul>
        {values.slice(0, 64).map((value) => (
          <li key={value}>
            <code>{value}</code>
          </li>
        ))}
      </ul>
      {fromFiles && <p className="editor-note">COLUMN is a column name from that input file.</p>}
    </div>
  );
}
