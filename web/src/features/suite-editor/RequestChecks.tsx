import { ScalarField } from './ScalarField.js';
import type { RawField } from './raw-drafts.js';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import { Card, TextField } from './fields.js';
import { numberOrRaw, objects, text, uniqueId, wholeOrRaw, without } from './model.js';
import type { Obj } from './model.js';
import { fieldId } from './problems.js';
import { blankCheck, checkKind, checkKinds, compareOperators } from './rules.js';

const checkFieldLabel = (n: number, field: string, shown: string) => (
  <>
    <span className="sr-only">{`Check ${n} ${field}`}</span>
    <span aria-hidden="true">{shown}</span>
  </>
);
const countsValue = (check: Obj) => (check.required === false ? 'optional' : 'required');
type Kind = NonNullable<ReturnType<typeof checkKind>>;
function typedValue(kind: Kind, value: string): unknown {
  if (kind.value === 'status' || kind.value === 'family') return wholeOrRaw(value);
  if (kind.value === 'number') return numberOrRaw(value);
  return value;
}

/** Kind-specific target fields of one check: header name, JSON path and comparison. */
function CheckTarget({ check, at, n, set }: { check: Obj; at: string; n: number; set: (next: Obj) => void }) {
  const kind = checkKind(check.kind);
  return (
    <>
      {kind?.name && (
        <TextField
          label={checkFieldLabel(n, 'header', 'Path or name')}
          path={`${at}/name`}
          value={check.name}
          maxLength={128}
          change={(name) => set({ ...check, name })}
        />
      )}
      {kind?.path && (
        <TextField
          label={checkFieldLabel(n, 'JSON path', 'Path or name')}
          path={`${at}/path`}
          value={check.path}
          maxLength={512}
          change={(value) => set({ ...check, path: value })}
        />
      )}
      {kind?.operator && (
        <Select
          label={`Check ${n} comparison`}
          value={text(check.operator)}
          onChange={(event) => set({ ...check, operator: event.target.value })}
        >
          {Object.entries(compareOperators).map(([id, symbol]) => (
            <option key={id} value={id}>
              {symbol}
            </option>
          ))}
        </Select>
      )}
    </>
  );
}

function CheckRow({
  check,
  at,
  n,
  set,
  remove,
  field,
}: {
  check: Obj;
  at: string;
  n: number;
  set: (next: Obj) => void | boolean;
  remove: () => void;
  field: RawField | null;
}) {
  const kind = checkKind(check.kind);
  return (
    <div className="field-row check-row" id={fieldId(at)} tabIndex={-1}>
      <Select
        label={checkFieldLabel(n, 'kind', 'Kind')}
        value={text(check.kind)}
        onChange={(event) => set(blankCheck(event.target.value, text(check.id), check.required !== false))}
      >
        {!kind && <option value={text(check.kind)}>Unknown</option>}
        {checkKinds.map((item) => (
          <option key={item.kind} value={item.kind}>
            {item.label}
          </option>
        ))}
      </Select>
      <div className="check-target">
        <CheckTarget check={check} at={at} n={n} set={set} />
        {!kind?.name && !kind?.path && (
          <TextInput label={checkFieldLabel(n, 'path or name', 'Path or name')} disabled value="—" />
        )}
      </div>
      <CheckValue kind={kind} check={check} at={at} n={n} field={field} set={set} />
      <Select
        label={checkFieldLabel(n, 'counts', 'Counts')}
        value={countsValue(check)}
        onChange={(event) => set({ ...check, required: event.target.value === 'required' })}
      >
        <option value="required">Required</option>
        <option value="optional">Optional</option>
      </Select>
      <Button variant="text" size="sm" aria-label={`Remove check ${n}`} onClick={remove}>
        Remove
      </Button>
    </div>
  );
}

function CheckValue({
  kind,
  check,
  at,
  n,
  field,
  set,
}: {
  kind: ReturnType<typeof checkKind>;
  check: Obj;
  at: string;
  n: number;
  field: RawField | null;
  set: (next: Obj) => void | boolean;
}) {
  if (!kind?.value) return <TextInput label={checkFieldLabel(n, 'value', 'Value')} disabled value="—" />;
  if (kind.value === 'scalar')
    return (
      <ScalarField
        field={field}
        n={n}
        path={`${at}/value`}
        value={check.value}
        apply={(value) => set({ ...check, value })}
      />
    );
  return (
    <TextField
      label={checkFieldLabel(n, 'value', 'Value')}
      path={`${at}/value`}
      value={check.value}
      change={(value) => set({ ...check, value: typedValue(kind, value) })}
    />
  );
}

/** The checks (k6 assertions) of one request: kind, target, comparison and value. */
export function Checks({
  request,
  path,
  change,
  fieldFor,
}: {
  request: Obj;
  path: string;
  change: (next: Obj) => void | boolean;
  fieldFor: (index: number) => RawField | null;
}) {
  const checks = objects(request.assertions);
  const update = (position: number, next: Obj) =>
    change({ ...request, assertions: checks.map((check, at) => (at === position ? next : check)) });
  const add = () =>
    change({
      ...request,
      assertions: [
        ...checks,
        blankCheck(
          'statusEq',
          uniqueId(
            'check',
            checks.map((check) => text(check.id)),
          ),
        ),
      ],
    });
  return (
    <Card
      title="Checks"
      className="request-checks"
      action={
        <Button variant="text" size="sm" disabled={checks.length >= 64} onClick={add}>
          Add check
        </Button>
      }
    >
      <p className="editor-note">A failed required check fails the run. A failed optional check is only counted.</p>
      <fieldset className="editor-rows" id={fieldId(`${path}/assertions`)} tabIndex={-1}>
        <legend className="sr-only">Checks</legend>
        {checks.map((check, position) => (
          <CheckRow
            key={checkKey(checks, position)}
            field={fieldFor(position)}
            check={check}
            at={`${path}/assertions/${position}`}
            n={position + 1}
            set={(next) => update(position, next)}
            remove={() => change({ ...request, assertions: without(request.assertions, position) })}
          />
        ))}
      </fieldset>
    </Card>
  );
}

function checkKey(checks: readonly Obj[], position: number): string {
  const id = checks[position]?.id;
  return typeof id === 'string' && checks.filter((check) => check.id === id).length === 1
    ? `id:${id}`
    : `position:${position}`;
}
