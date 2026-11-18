import type { FileColumns } from './useInputColumns.js';
import { Button } from '../../components/Button.js';
import { useRef, useState } from 'react';
import type { FocusEvent } from 'react';
import type { Config } from '../suites/draft.js';
import { Card } from './fields.js';
import { identifierPattern, isObj, objects, text } from './model.js';
import type { Obj } from './model.js';

type TextControl = HTMLInputElement | HTMLTextAreaElement;
function canInsert(field: TextControl | null): field is TextControl {
  return !!field?.isConnected && !field.matches(':disabled') && !field.readOnly;
}
/** Insert through the native input event, so React's owning field validates and updates the shared draft. */
export function useValueInsertion() {
  const target = useRef<TextControl | null>(null);
  return {
    capture: (event: FocusEvent<HTMLDivElement>) => {
      const element = event.target;
      if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
      const eligible = element.id.startsWith('suite-field/requests/') || element.id.startsWith('inline-body-');
      if (eligible && !element.disabled && !element.readOnly && element.selectionStart !== null)
        target.current = element;
    },
    insert: (value: string): boolean => {
      const field = target.current;
      if (!canInsert(field)) return false;
      const start = field.selectionStart ?? field.value.length;
      const end = field.selectionEnd ?? start;
      const next = field.value.slice(0, start) + value + field.value.slice(end);
      const limit = field.maxLength >= 0 ? Math.min(field.maxLength, 1_048_576) : 1_048_576;
      if (next.length > limit) return false;
      const prototype =
        field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, 'value')?.set;
      if (!setter) return false;
      setter.call(field, next);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      field.focus();
      field.setSelectionRange(start + value.length, start + value.length);
      return true;
    },
  };
}
function paletteValues(config: Config, files?: FileColumns) {
  const values = new Set<string>();
  let unavailable = false;
  for (const dataset of objects(config.datasets).slice(0, 64)) {
    const id = text(dataset.id);
    if (!identifierPattern.test(id)) continue;
    const columns = datasetColumns(dataset, files);
    if (columns === null) unavailable = true;
    for (const column of (columns ?? []).slice(0, 64))
      if (identifierPattern.test(column)) values.add(`{{data.${id}.${column}}}`);
  }
  for (const secret of objects(config.secrets).slice(0, 64)) {
    const name = text(secret.name);
    if (identifierPattern.test(name)) values.add(`{{secret.${name}}}`);
  }
  return { values: [...values].slice(0, 64), unavailable };
}
/** Only known columns and secret reference names; no secret values or guessed file columns. */
export function ValuePalette({
  config,
  insert,
  files,
}: {
  config: Config;
  insert: (value: string) => boolean;
  files?: FileColumns;
}) {
  const { values, unavailable } = paletteValues(config, files);
  const [failed, setFailed] = useState(false);
  return (
    <Card title="Values you can use" className="value-palette">
      <p className="editor-note">Click one to insert it where the cursor is.</p>
      <ul>
        {values.map((value) => (
          <li key={value}>
            <button
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setFailed(!insert(value))}
            >
              <code>{value}</code>
            </button>
          </li>
        ))}
      </ul>
      <ColumnStatus files={files} unavailable={unavailable} />
      {!values.length && !files?.pending && (
        <p className="editor-note">No known data columns or secret references in this draft.</p>
      )}
      {failed && (
        <p className="field-error" role="alert">
          Choose a text field with enough room, then insert the value again.
        </p>
      )}
    </Card>
  );
}

function datasetColumns(dataset: Obj, files: FileColumns | undefined): readonly string[] | null {
  if (dataset.kind === 'range') return [text(dataset.column)];
  if (dataset.kind === 'inline' && isObj(objects(dataset.rows)[0])) return Object.keys(objects(dataset.rows)[0]!);
  return files?.columns.get(text(dataset.id)) ?? null;
}
const unknownColumns = (
  <p className="editor-note">
    Column names could not be determined for an input. You can still type a known reference.
  </p>
);
function ColumnStatus({ files, unavailable }: { files: FileColumns | undefined; unavailable: boolean }) {
  if (!files) return unavailable ? unknownColumns : null;
  return (
    <>
      {files.pending && (
        <p className="editor-note" role="status">
          Reading input column names…
        </p>
      )}
      {files.failed && (
        <div role="alert">
          <p className="field-error">Could not read input column names. Your draft is kept.</p>
          <Button size="sm" disabled={files.pending} onClick={files.retry}>
            Retry column names
          </Button>
        </div>
      )}
      {unavailable && !files.pending && !files.failed && unknownColumns}
    </>
  );
}
