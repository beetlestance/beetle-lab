import type { WorkspaceScope } from '@beetle/contracts/api';
import { useInputColumns } from './useInputColumns.js';
import { useState } from 'react';
import { Button } from '../../components/Button.js';
import { Select } from '../../components/Fields.js';
import { SegmentedFilter } from '../../components/SegmentedFilter.js';
import type { Config } from '../suites/draft.js';
import { formatDraft, parseDraft } from '../suites/draft.js';
import { Card, TextField } from './fields.js';
import type { InputCatalog } from './fields.js';
import { isObj, methods, objects, text, uniqueId } from './model.js';
import type { Obj, SetConfig } from './model.js';
import { ValuePalette, useValueInsertion } from './ValuePalette.js';
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
  scope,
  config,
  set,
  index,
  inputs,
  close,
}: {
  scope: WorkspaceScope;
  config: Config;
  set: SetConfig;
  index: number;
  inputs: InputCatalog;
  close: () => void;
}) {
  const insertion = useValueInsertion();
  const fileColumns = useInputColumns(scope, config);
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
    <div className="request-editor-cards" onFocusCapture={insertion.capture}>
      <Card title="Request" className="request-properties">
        <RequestHead request={request} path={path} change={change} />
      </Card>
      <Pairs
        title="Query parameters"
        path={`${path}/query`}
        value={request.query}
        hint="Added to the URL as ?name=value. Values can use {{data.users.column}} or {{secret.name}}."
        change={(query) => change({ ...request, query })}
      />
      <Pairs
        title="Headers"
        path={`${path}/headers`}
        value={request.headers}
        hint="Up to 64. A secret is written as {{secret.api_token}}; its value is filled in on the agent just before the run and never saved with the suite."
        change={(headers) => change({ ...request, headers })}
      />
      <Card title="Body">
        <Body request={request} index={index} inputs={inputs} change={change} />
      </Card>
      <Checks request={request} path={path} change={change} />
      <ValuePalette config={config} insert={insertion.insert} files={fileColumns} />
    </div>
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
  const [nameError, setNameError] = useState('');
  const rename = (position: number, name: string) => {
    if (entries.some(([key], at) => at !== position && key.toLowerCase() === name.toLowerCase())) {
      setNameError('That name is already used. Choose a different name; both values are kept.');
      return;
    }
    setNameError('');
    change(Object.fromEntries(entries.map((entry, at) => (at === position ? [name, entry[1]] : entry))));
  };
  const write = (next: [string, unknown][]) => change(Object.fromEntries(next));
  const label = title === 'Query parameters' ? 'parameter' : 'header';
  return (
    <Card
      title={title}
      className={title === 'Headers' ? 'request-headers' : 'request-query'}
      action={
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
      }
    >
      <fieldset className="editor-rows" id={fieldId(path)} tabIndex={-1}>
        <legend className="sr-only">{title}</legend>
        {hint && <p className="editor-note">{hint}</p>}
        {nameError && (
          <p className="field-error" role="alert">
            {nameError}
          </p>
        )}
        {entries.map((entry, position) => (
          <PairRow
            key={position}
            entry={entry}
            position={position}
            path={path}
            title={title}
            removeLabel={`Remove ${label} ${position + 1}`}
            rename={(name) => rename(position, name)}
            edit={(value) => write(entries.map((entry, at) => (at === position ? [entry[0], value] : entry)))}
            remove={() => write(entries.filter((_, at) => at !== position))}
          />
        ))}
      </fieldset>
    </Card>
  );
}

function PairRow({
  entry,
  position,
  path,
  title,
  removeLabel,
  rename,
  edit,
  remove,
}: {
  entry: [string, unknown];
  position: number;
  path: string;
  title: string;
  removeLabel: string;
  rename: (name: string) => void;
  edit: (value: string) => void;
  remove: () => void;
}) {
  return (
    <div className="field-row pair-row">
      <TextField
        label={`${title} ${position + 1} name`}
        hideLabel
        path={`${path}/${position}/name`}
        value={entry[0]}
        maxLength={128}
        placeholder="Name"
        change={rename}
      />
      <TextField
        label={`${title} ${position + 1} value`}
        hideLabel
        path={`${path}/${position}/value`}
        value={entry[1]}
        placeholder="Value"
        change={edit}
      />
      <Button variant="text" size="sm" aria-label={removeLabel} onClick={remove}>
        Remove
      </Button>
    </div>
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
  const [inline, setInline] = useState(() => (body?.kind === 'json' ? formatDraft(body.value ?? null) : '{}'));
  const [error, setError] = useState('');
  return (
    <div className="field">
      <label className="sr-only" htmlFor={`inline-body-${index}`}>
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
      <legend className="sr-only">Body</legend>
      <SegmentedFilter
        label="Body"
        value={mode}
        options={[
          { value: 'none', label: 'None' },
          { value: 'inline', label: 'Inline JSON' },
          { value: 'input', label: 'From an input' },
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
        Rendered bodies may be up to 8 MiB, and one run may load at most 32 MiB of bodies and inputs. To send a large or
        binary file, choose From an input.
      </p>
    </fieldset>
  );
}
