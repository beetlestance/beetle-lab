import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import { Card, TextField } from './fields.js';
import { numberOrRaw, objects, text, uniqueId, wholeOrRaw, without } from './model.js';
import type { Obj } from './model.js';
import { fieldId } from './problems.js';
import { blankCheck, checkKind, checkKinds, compareOperators } from './rules.js';

const countsValue = (check: Obj) => (check.required === false ? 'optional' : 'required');
type Kind = NonNullable<ReturnType<typeof checkKind>>;
function typedValue(kind: Kind, value: string): unknown {
  if (kind.value === 'status' || kind.value === 'family') return wholeOrRaw(value);
  if (kind.value === 'number' || kind.value === 'scalar') return numberOrRaw(value);
  return value;
}

/** Kind-specific target fields of one check: header name, JSON path and comparison. */
function CheckTarget({ check, at, n, set }: { check: Obj; at: string; n: number; set: (next: Obj) => void }) {
  const kind = checkKind(check.kind);
  return (
    <>
      {kind?.name && (
        <TextField
          label={`Check ${n} header`}
          path={`${at}/name`}
          value={check.name}
          maxLength={128}
          change={(name) => set({ ...check, name })}
        />
      )}
      {kind?.path && (
        <TextField
          label={`Check ${n} JSON path`}
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
}: {
  check: Obj;
  at: string;
  n: number;
  set: (next: Obj) => void;
  remove: () => void;
}) {
  const kind = checkKind(check.kind);
  return (
    <div className="field-row check-row" id={fieldId(at)} tabIndex={-1}>
      <Select
        label={`Check ${n} kind`}
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
        {!kind?.name && !kind?.path && <TextInput label={`Check ${n} path or name`} disabled value="—" />}
      </div>
      {kind?.value && (
        <TextField
          label={`Check ${n} value`}
          path={`${at}/value`}
          value={check.value}
          change={(value) => set({ ...check, value: typedValue(kind, value) })}
        />
      )}
      {!kind?.value && <TextInput label={`Check ${n} value`} disabled value="—" />}
      <Select
        label={`Check ${n} counts`}
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

/** The checks (k6 assertions) of one request: kind, target, comparison and value. */
export function Checks({ request, path, change }: { request: Obj; path: string; change: (next: Obj) => void }) {
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
      action={
        <Button variant="text" disabled={checks.length >= 64} onClick={add}>
          Add check
        </Button>
      }
    >
      <p className="editor-note">A failed required check fails the run. A failed optional check is only counted.</p>
      <fieldset className="editor-rows" id={fieldId(`${path}/assertions`)} tabIndex={-1}>
        <legend className="sr-only">Checks</legend>
        {checks.map((check, position) => (
          <CheckRow
            key={position}
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
