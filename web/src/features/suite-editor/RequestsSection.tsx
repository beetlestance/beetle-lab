import type { ReactNode } from 'react';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import type { Config } from '../suites/draft.js';
import { Card } from './fields.js';
import type { InputCatalog } from './fields.js';
import {
  addRequest,
  firstScenario,
  inputRef,
  isObj,
  methods,
  numberText,
  objects,
  removeRequest,
  setEntry,
  text,
  weightOf,
  wholeOrRaw,
  without,
} from './model.js';
import type { Obj, SetConfig } from './model.js';
import { fieldId } from './problems.js';
import { checkLabel } from './rules.js';

const sr = (label: string, prefix: string): ReactNode => (
  <>
    <span className="sr-only">{prefix}</span> {label}
  </>
);

export function setRequest(config: Config, index: number, request: Obj): Config {
  return {
    ...config,
    requests: objects(config.requests).map((item, position) => (position === index ? request : item)),
  };
}

function selectedBody(body: Obj | undefined): string {
  if (body?.kind === 'input' && isObj(body.input)) return text(body.input.id).toLowerCase();
  return body?.kind === 'json' ? 'inline' : '';
}
/** The body for a select value: inline JSON (kept if already inline), a listed input, or none. */
function chosenBody(value: string, body: Obj | undefined, inputs: InputCatalog): Obj | null | undefined {
  if (!value) return null;
  if (value === 'inline') return { kind: 'json', value: body?.kind === 'json' ? body.value : {} };
  const choice = inputs.choices.find((item) => item.id.toLowerCase() === value);
  if (!choice) return undefined;
  return { kind: 'input', input: inputRef(choice), format: choice.name.endsWith('.json') ? 'json' : 'text' };
}

/** Body choice: none, inline JSON or a published input file. */
export function BodySelect({
  request,
  index,
  inputs,
  change,
  label = 'Body from input',
}: {
  request: Obj;
  index: number;
  inputs: InputCatalog;
  change: (request: Obj) => void;
  label?: string;
}) {
  const body = isObj(request.body) ? request.body : undefined;
  const selected = selectedBody(body);
  const unlisted =
    selected !== '' && selected !== 'inline' && !inputs.choices.some((choice) => choice.id.toLowerCase() === selected);
  return (
    <Select
      id={fieldId(`/requests/${index}/body`)}
      label={sr(label, `Request ${index + 1}`)}
      value={selected}
      loading={inputs.loading && !selected}
      onChange={(event) => {
        const next = chosenBody(event.target.value, body, inputs);
        const rest = { ...request };
        delete rest.body;
        if (next === null) change(rest);
        else if (next) change({ ...rest, body: next });
      }}
    >
      <option value="">None</option>
      <option value="inline">Inline JSON</option>
      {unlisted && (
        <option value={selected}>{inputs.name(selected) ?? `Input ${selected.slice(0, 8)}`} (not available)</option>
      )}
      {inputs.choices.map((choice) => (
        <option key={choice.id} value={choice.id.toLowerCase()}>
          {choice.name}
        </option>
      ))}
    </Select>
  );
}

function CheckChips({
  request,
  index,
  change,
  add,
}: {
  request: Obj;
  index: number;
  change: (next: Obj) => void;
  add: () => void;
}) {
  const checks = objects(request.assertions);
  return (
    <ul className="check-chips" aria-label={`Request ${index + 1} checks`}>
      {checks.map((check, position) => (
        <li key={position} className="chip">
          {checkLabel(check)}
          {check.required === false && <span className="chip-note"> optional</span>}
          <button
            type="button"
            className="chip-remove"
            aria-label={`Remove check ${checkLabel(check)} from request ${index + 1}`}
            onClick={() => change({ ...request, assertions: without(request.assertions, position) })}
          >
            ×
          </button>
        </li>
      ))}
      <li>
        <Button
          variant="text"
          size="sm"
          disabled={checks.length >= 64}
          aria-label={`Add check to request ${index + 1}`}
          onClick={add}
        >
          Add check
        </Button>
      </li>
    </ul>
  );
}

function RequestRow({
  config,
  set,
  inputs,
  open,
  index,
}: {
  config: Config;
  set: SetConfig;
  inputs: InputCatalog;
  open: (index: number, addCheck?: boolean) => void;
  index: number;
}) {
  const request = objects(config.requests)[index]!;
  const scenario = firstScenario(config);
  const change = (next: Obj) => set(setRequest(config, index, next));
  const name = `Request ${index + 1}`;
  return (
    <li className="request-row">
      <div className="field-row request-fields">
        <Select
          id={fieldId(`/requests/${index}/method`)}
          label={sr('Method', name)}
          value={text(request.method)}
          onChange={(event) => change({ ...request, method: event.target.value })}
        >
          {!methods.includes(request.method as (typeof methods)[number]) && (
            <option value={text(request.method)}>Choose</option>
          )}
          {methods.map((method) => (
            <option key={method}>{method}</option>
          ))}
        </Select>
        <TextInput
          id={fieldId(`/requests/${index}/path`)}
          label={sr('Path', name)}
          maxLength={4096}
          value={text(request.path)}
          onChange={(event) => change({ ...request, path: event.target.value })}
        />
        {scenario && (
          <TextInput
            id={fieldId(`/requests/${index}/weight`)}
            label={sr('Weight', name)}
            inputMode="numeric"
            maxLength={8}
            value={numberText(weightOf(config, text(request.id)))}
            onChange={(event) =>
              set(
                setEntry(config, text(scenario.id), text(request.id), {
                  weight: wholeOrRaw(event.target.value.trim()),
                }),
              )
            }
          />
        )}
        <BodySelect request={request} index={index} inputs={inputs} change={change} />
        <div className="row-actions">
          <Button variant="text" size="sm" aria-label={`Edit request ${index + 1}`} onClick={() => open(index)}>
            Details
          </Button>
          <Button
            variant="text"
            size="sm"
            aria-label={`Remove request ${index + 1}`}
            disabled={objects(config.requests).length <= 1}
            onClick={() => set(removeRequest(config, index))}
          >
            Remove
          </Button>
        </div>
      </div>
      <CheckChips request={request} index={index} change={change} add={() => open(index, true)} />
    </li>
  );
}

export function RequestsSection({
  config,
  set,
  inputs,
  open,
}: {
  config: Config;
  set: SetConfig;
  inputs: InputCatalog;
  open: (index: number, addCheck?: boolean) => void;
}) {
  const requests = objects(config.requests);
  return (
    <Card
      title="Requests"
      action={
        <Button variant="text" disabled={requests.length >= 64} onClick={() => set(addRequest(config))}>
          Add request
        </Button>
      }
    >
      <ol className="request-list">
        {requests.map((_, index) => (
          <RequestRow key={index} config={config} set={set} inputs={inputs} open={open} index={index} />
        ))}
      </ol>
    </Card>
  );
}
