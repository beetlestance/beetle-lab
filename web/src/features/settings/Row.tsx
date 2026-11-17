import type { ReactNode } from 'react';
import { Button } from '../../components/Button.js';
import { Select, TextInput } from '../../components/Fields.js';
import type { DraftValue, RowFacts } from './model.js';

/**
 * One setting (Penpot "Settings" rows and "Field states"): label, help, where the value
 * comes from, the field, and Inherit instead / Undo. Unsaved rows are marked amber.
 */
export function SettingRow({
  row,
  value,
  error,
  disabled,
  onChange,
  extra,
}: {
  row: RowFacts;
  value: DraftValue | undefined;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: DraftValue | undefined) => void;
  extra?: ReactNode;
}) {
  const state = rowState(row, value, error);
  return (
    <li className={`setting-row setting-row-${state.tone}`}>
      <div className="setting-copy">
        <h3>{row.label}</h3>
        <p>{row.help}</p>
        {row.note && <p>{row.note}</p>}
        <p className="setting-origin">{state.origin}</p>
      </div>
      <div className="setting-control">
        <Field row={row} value={value} error={error} disabled={disabled} onChange={onChange} />
        {row.unit && <span className="setting-unit">{row.unit.label}</span>}
        {value ? (
          <Button variant="text" size="sm" disabled={disabled} onClick={() => onChange(undefined)}>
            Undo
          </Button>
        ) : (
          row.canInherit && (
            <Button variant="text" size="sm" disabled={disabled} onClick={() => onChange({ kind: 'inherit' })}>
              Inherit instead
            </Button>
          )
        )}
        {extra}
      </div>
    </li>
  );
}

function rowState(row: RowFacts, value: DraftValue | undefined, error: string | undefined) {
  if (error) return { tone: 'error', origin: 'Not saved: fix this value first' };
  if (!value) return { tone: row.setHere ? 'here' : 'inherited', origin: row.origin };
  if (value.kind === 'inherit') return { tone: 'changed', origin: 'Will inherit, not saved yet' };
  return { tone: 'changed', origin: 'Changed here, not saved yet' };
}

interface FieldProps {
  row: RowFacts;
  value: DraftValue | undefined;
  error: string | undefined;
  disabled: boolean;
  onChange: (value: DraftValue | undefined) => void;
}

function Field({ row, value, error, disabled, onChange }: FieldProps) {
  const inherit = value?.kind === 'inherit';
  const text = value?.kind === 'set' ? value.text : inherit ? '' : row.text;
  // Typing a set-here value back to what is saved is no change; on an inherited row it is an override.
  const set = (next: string) => onChange(row.setHere && next === row.text ? undefined : { kind: 'set', text: next });
  const common = { label: row.label, hideLabel: true, value: text, error, disabled: disabled || inherit };
  if (row.options)
    return (
      <Select {...common} onChange={(event) => set(event.target.value)}>
        {inherit && <option value="">Inherited after saving</option>}
        {row.options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </Select>
    );
  return <TextInput {...common} {...textAttributes(row, inherit)} onChange={(event) => set(event.target.value)} />;
}

function textAttributes(row: RowFacts, inherit: boolean) {
  return {
    placeholder: inherit ? 'Inherited after saving' : undefined,
    inputMode: row.unit ? ('decimal' as const) : undefined,
    maxLength: row.unit ? 24 : 128,
  };
}
