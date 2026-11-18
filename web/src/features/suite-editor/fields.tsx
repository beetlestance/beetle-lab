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
export function Card({
  title,
  action,
  children,
  className = '',
}: {
  title: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  const id = useId();
  return (
    <section className={`editor-card ${className}`.trim()} aria-labelledby={id}>
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
  placeholder,
}: {
  label: ReactNode;
  path: string;
  value: unknown;
  change: (value: number | string) => void;
  hint?: string;
  hideLabel?: boolean;
  placeholder?: string;
}) {
  return (
    <TextInput
      id={fieldId(path)}
      label={label}
      hideLabel={hideLabel}
      hint={hint}
      inputMode="numeric"
      maxLength={16}
      placeholder={placeholder}
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
  className,
}: {
  label: ReactNode;
  path: string;
  value: unknown;
  change: (value: string) => void;
  hint?: string;
  hideLabel?: boolean;
  maxLength?: number;
  placeholder?: string;
  className?: string | undefined;
}) {
  return (
    <TextInput
      id={fieldId(path)}
      className={className}
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

/** Seconds in the form, exact integer milliseconds in the configuration; invalid text remains invalid. */
export function SecondsField({
  label,
  path,
  value,
  change,
  hint,
}: {
  label: ReactNode;
  path: string;
  value: unknown;
  change: (milliseconds: number | string) => void;
  hint?: string;
}) {
  return (
    <TextInput
      id={fieldId(path)}
      label={label}
      hint={hint}
      inputMode="decimal"
      maxLength={20}
      value={typeof value === 'number' ? String(value / 1000) : numberText(value)}
      onChange={(event) => {
        const raw = event.target.value;
        const [whole, fraction = ''] = raw.split('.');
        const milliseconds = Number(whole) * 1000 + Number(fraction.padEnd(3, '0'));
        change(
          /^(0|[1-9][0-9]{0,8})(\.[0-9]{1,3})?$/.test(raw) && Number.isSafeInteger(milliseconds) ? milliseconds : raw,
        );
      }}
    />
  );
}
