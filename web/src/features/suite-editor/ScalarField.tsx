import { TextInput } from '../../components/Fields.js';
import { fieldId } from './problems.js';
import type { RawField } from './raw-drafts.js';
import { useRawJsonField } from './useRawJsonField.js';

/** JSON literals preserve the difference between "true", true, null and numeric values. */
export function ScalarField({
  field,
  value,
  path,
  n,
  apply,
}: {
  field: RawField | null;
  value: unknown;
  path: string;
  n: number;
  apply: (value: unknown) => void | boolean;
}) {
  const draft = useRawJsonField(field, value, apply, true);
  return (
    <TextInput
      id={fieldId(path)}
      label={
        <>
          <span className="sr-only">Check {n} value</span>
          <span aria-hidden="true">Value</span>
        </>
      }
      value={draft.text}
      maxLength={32768}
      readOnly={draft.readOnly}
      error={draft.error || undefined}
      onChange={(event) => draft.change(event.target.value)}
    />
  );
}
