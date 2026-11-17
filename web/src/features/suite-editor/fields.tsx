import { useId } from 'react';
import type { ReactNode } from 'react';
import { TextInput } from '../../components/Fields.js';
import { numberText, wholeOrRaw } from './model.js';
import type { InputChoice } from './model.js';
import { fieldId } from './problems.js';

export type InputCatalog = {
  choices: readonly InputChoice[];
  loading: boolean;
  /** Name of an input referenced by the draft, when known. */
  name(id: string): string | undefined;
};

/** A titled form card; `action` sits at the right of the heading. */
export function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  const id = useId();
  return (
    <section className="editor-card" aria-labelledby={id}>
      <header className="editor-card-head">
        <h3 id={id}>{title}</h3>
        {action}
      </header>
      {children}
    </section>
  );
}

/** Whole-number field; non-numbers stay in the draft as typed so validation names them. */
export function WholeField({
  label,
  path,
  value,
  change,
  hint,
  hideLabel,
}: {
  label: string;
  path: string;
  value: unknown;
  change: (value: number | string) => void;
  hint?: string;
  hideLabel?: boolean;
}) {
  return (
    <TextInput
      id={fieldId(path)}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      inputMode="numeric"
      maxLength={16}
      value={numberText(value)}
      onChange={(event) => change(wholeOrRaw(event.target.value.trim()))}
    />
  );
}

export function TextField({
  label,
  path,
  value,
  change,
  hint,
  hideLabel,
  maxLength = 4096,
  placeholder,
}: {
  label: string;
  path: string;
  value: unknown;
  change: (value: string) => void;
  hint?: string;
  hideLabel?: boolean;
  maxLength?: number;
  placeholder?: string;
}) {
  return (
    <TextInput
      id={fieldId(path)}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      maxLength={maxLength}
      placeholder={placeholder}
      value={typeof value === 'string' ? value : numberText(value)}
      onChange={(event) => change(event.target.value)}
    />
  );
}
