import { createContext, useContext, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ApiClientFailure, ApiClientResult } from '@beetle/contracts/api';
import { errorMessage, unknownOutcome } from '../app/api.js';
import { Dialog } from './Dialog.js';

export interface EditorField {
  name: string;
  label: string;
  value: string;
  pattern?: string;
  maxLength?: number;
  help?: string;
  required?: boolean;
  options?: readonly string[];
  /** Inline message when the server refuses this field as already used (a `conflict` field issue). */
  conflict?: (value: string) => string;
}
export interface EditorIntent {
  title: string;
  path: string;
  fields: EditorField[];
  submit: (values: Readonly<Record<string, string>>, requestId: string) => Promise<ApiClientResult<unknown>>;
  refresh: () => Promise<unknown>;
}
interface EditorContextValue {
  open: (intent: EditorIntent) => void;
  busy: boolean;
}
const EditorContext = createContext<EditorContextValue | null>(null);
export function useEditor() {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('Editor provider required');
  return editor;
}
export function EditorProvider({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState<EditorIntent | null>(null);
  return (
    <EditorContext.Provider value={{ open: setIntent, busy: !!intent }}>
      {children}
      {intent && <Editor key={intent.title + intent.path} intent={intent} close={() => setIntent(null)} />}
    </EditorContext.Provider>
  );
}
interface Attempt {
  requestId: string;
  values: Readonly<Record<string, string>>;
}
function initialValues(fields: EditorField[]) {
  return Object.fromEntries(fields.map((field) => [field.name, field.value]));
}
/** Field-level conflicts the form can explain next to the field; anything else stays a form-level failure. */
function fieldErrors(fields: EditorField[], failure: ApiClientFailure | null, values: Readonly<Record<string, string>>) {
  const paths = new Set((failure?.protocol?.fields ?? []).filter((f) => f.code === 'conflict').map((f) => f.path));
  return Object.fromEntries(
    fields.flatMap((field) =>
      field.conflict && paths.has(`/${field.name}`) ? [[field.name, field.conflict(values[field.name] ?? '')]] : [],
    ),
  ) as Readonly<Record<string, string>>;
}
function Editor({ intent, close }: { intent: EditorIntent; close: () => void }) {
  const location = useLocation();
  const id = useId();
  const [values, setValues] = useState(() => initialValues(intent.fields));
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [failure, setFailure] = useState<ApiClientFailure | null>(null);
  const [pending, setPending] = useState(false);
  const [saved, setSaved] = useState(false);
  const unknown = failure && unknownOutcome(failure);
  const errors = fieldErrors(intent.fields, failure, attempt?.values ?? values);
  async function send(replay: boolean) {
    const next = replay && attempt ? attempt : { requestId: crypto.randomUUID(), values: { ...values } };
    setAttempt(next);
    setPending(true);
    setFailure(null);
    let reply: ApiClientResult<unknown>;
    try {
      reply = await intent.submit(next.values, next.requestId);
    } catch {
      reply = { ok: false, error: { kind: 'transport' } };
    }
    setPending(false);
    if (!reply.ok) {
      setFailure(reply.error);
      return;
    }
    setSaved(true);
    await intent.refresh();
  }
  if (saved) return <SavedDialog title={intent.title} close={close} />;
  if (location.pathname !== intent.path)
    return (
      <aside className="draft-banner" role="status">
        Your {intent.title.toLowerCase()} draft is preserved. <Link to={intent.path}>Return to draft</Link>
      </aside>
    );
  return (
    <Dialog title={intent.title} onClose={close} dismissible={!pending}>
      <form
        className="editor"
        aria-label={intent.title}
        onSubmit={(event) => {
          event.preventDefault();
          void send(false);
        }}
      >
        <fieldset disabled={pending}>
          <legend className="sr-only">{intent.title}</legend>
          <EditorFields
            fields={intent.fields}
            id={id}
            values={values}
            errors={errors}
            change={(name, value) => {
              setValues({ ...values, [name]: value });
              setFailure(null);
              setAttempt(null);
            }}
          />
          <EditorActions close={close} pending={pending} blocked={!!unknown} />
        </fieldset>
      </form>
      {pending && <p role="status">Sending changes…</p>}
      {failure && Object.keys(errors).length === 0 && (
        <EditorFailure failure={failure} unknown={!!unknown} retry={() => void send(true)} refresh={intent.refresh} />
      )}
    </Dialog>
  );
}
function SavedDialog({ title, close }: { title: string; close: () => void }) {
  return (
    <Dialog
      title={title}
      onClose={close}
      actions={
        <button type="button" className="primary" onClick={close}>
          Close editor
        </button>
      }
    >
      <p role="status">Changes saved.</p>
    </Dialog>
  );
}
function EditorActions({ close, pending, blocked }: { close: () => void; pending: boolean; blocked: boolean }) {
  return (
    <div className="dialog-actions">
      <button type="button" onClick={close}>
        Discard draft
      </button>
      <button className="primary" type="submit" disabled={blocked}>
        {pending ? 'Saving…' : 'Save'}
      </button>
    </div>
  );
}
function EditorFailure({
  failure,
  unknown,
  retry,
  refresh,
}: {
  failure: ApiClientFailure;
  unknown: boolean;
  retry: () => void;
  refresh: () => Promise<unknown>;
}) {
  return (
    <div role="alert" className="notice error">
      <p>{errorMessage(failure)}</p>
      {unknown && (
        <>
          <p>The outcome is unknown. Retry sends the identical request. Editing a field starts a new intent.</p>
          <button onClick={retry}>Retry identical request</button>
        </>
      )}
      {failure.protocol?.code === 'conflict' && (
        <>
          <p>Refresh to see the latest version. Your draft is preserved; discard and reopen it to use that version.</p>
          <button onClick={() => void refresh()}>Refresh latest version</button>
        </>
      )}
    </div>
  );
}

function EditorFields({
  fields,
  id,
  values,
  errors,
  change,
}: {
  fields: EditorField[];
  id: string;
  values: Readonly<Record<string, string>>;
  errors: Readonly<Record<string, string>>;
  change(name: string, value: string): void;
}) {
  return (
    <>
      {fields.map((field, index) => (
        <div className="field" key={field.name}>
          <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
          {field.options ? (
            <select
              id={`${id}-${field.name}`}
              name={field.name}
              value={values[field.name] ?? ''}
              autoFocus={index === 0}
              required={field.required ?? true}
              onChange={(event) => {
                change(field.name, event.target.value);
              }}
            >
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          ) : (
            <input
              id={`${id}-${field.name}`}
              name={field.name}
              value={values[field.name] ?? ''}
              autoFocus={index === 0}
              required={field.required ?? true}
              maxLength={field.maxLength ?? 128}
              pattern={field.pattern}
              aria-invalid={errors[field.name] ? true : undefined}
              aria-describedby={describedBy(id, field, !!errors[field.name])}
              onChange={(event) => {
                change(field.name, event.target.value);
              }}
            />
          )}
          {errors[field.name] && (
            <p role="alert" id={`${id}-${field.name}-error`} className="field-error">
              {errors[field.name]}
            </p>
          )}
          {field.help && <small id={`${id}-${field.name}-help`}>{field.help}</small>}
        </div>
      ))}
    </>
  );
}
function describedBy(id: string, field: EditorField, invalid: boolean): string | undefined {
  const ids = [invalid ? `${id}-${field.name}-error` : '', field.help ? `${id}-${field.name}-help` : ''].filter(Boolean);
  return ids.length ? ids.join(' ') : undefined;
}
