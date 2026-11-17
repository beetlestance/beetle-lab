import { useId } from 'react';
import type { InputHTMLAttributes, ReactNode, SelectHTMLAttributes } from 'react';
import './primitives.css';

type FieldFrame = {
  label: ReactNode;
  /** Visually hides the label; it stays the accessible name. */
  hideLabel?: boolean | undefined;
  hint?: ReactNode | undefined;
  /** Shown under the field in red; also sets aria-invalid. */
  error?: ReactNode | undefined;
};

function useFieldIds(id: string | undefined, hint: ReactNode, error: ReactNode) {
  const generated = useId();
  const fieldId = id ?? generated;
  const hintId = hint ? `${fieldId}-hint` : undefined;
  const errorId = error ? `${fieldId}-error` : undefined;
  const describedBy = [hintId, errorId].filter(Boolean).join(' ') || undefined;
  return { fieldId, hintId, errorId, describedBy };
}

function FieldMessages({
  hint,
  error,
  hintId,
  errorId,
}: {
  hint: ReactNode;
  error: ReactNode;
  hintId?: string | undefined;
  errorId?: string | undefined;
}) {
  return (
    <>
      {hint && (
        <small className="field-hint" id={hintId}>
          {hint}
        </small>
      )}
      {error && (
        <small className="field-error" id={errorId}>
          {error}
        </small>
      )}
    </>
  );
}

export type TextInputProps = FieldFrame &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & {
    type?: 'text' | 'search' | 'url' | 'email' | 'number' | 'password' | undefined;
  };

/** Labelled text input with hint and error message. */
export function TextInput({ label, hideLabel, hint, error, id, className, type = 'text', ...rest }: TextInputProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className={hideLabel ? 'sr-only' : 'field-label'} htmlFor={ids.fieldId}>
        {label}
      </label>
      <input
        {...rest}
        id={ids.fieldId}
        type={type}
        className="input"
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
      />
      <FieldMessages hint={hint} error={error} hintId={ids.hintId} errorId={ids.errorId} />
    </div>
  );
}

export type SelectProps = FieldFrame &
  SelectHTMLAttributes<HTMLSelectElement> & {
    /** Options are still loading: the select is disabled and says so. */
    loading?: boolean | undefined;
    /** Placeholder option shown when no value is chosen. */
    placeholder?: string | undefined;
  };

/** Labelled native select with the design's caret, loading and error states. */
export function Select({
  label,
  hideLabel,
  hint,
  error,
  id,
  className,
  loading,
  placeholder,
  children,
  ...rest
}: SelectProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className={hideLabel ? 'sr-only' : 'field-label'} htmlFor={ids.fieldId}>
        {label}
      </label>
      <select
        {...rest}
        id={ids.fieldId}
        className="select"
        disabled={loading || rest.disabled}
        aria-busy={loading || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={ids.describedBy}
      >
        {loading ? (
          <option value="">Loading…</option>
        ) : (
          <>
            {placeholder !== undefined && (
              <option value="" disabled>
                {placeholder}
              </option>
            )}
            {children}
          </>
        )}
      </select>
      <FieldMessages hint={hint} error={error} hintId={ids.hintId} errorId={ids.errorId} />
    </div>
  );
}

export type CheckboxProps = Omit<FieldFrame, 'hideLabel'> & Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>;

/** Checkbox with its label to the right. */
export function Checkbox({ label, hint, error, id, className, ...rest }: CheckboxProps) {
  const ids = useFieldIds(id, hint, error);
  return (
    <div className={['field', className].filter(Boolean).join(' ')}>
      <label className="checkbox" htmlFor={ids.fieldId}>
        <input
          {...rest}
          id={ids.fieldId}
          type="checkbox"
          aria-invalid={error ? true : undefined}
          aria-describedby={ids.describedBy}
        />
        {label}
      </label>
      <FieldMessages hint={hint} error={error} hintId={ids.hintId} errorId={ids.errorId} />
    </div>
  );
}
