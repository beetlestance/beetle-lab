import { createContext, useContext, useId, useState } from 'react';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import type { ApiClientFailure, ApiClientResult } from '@beetle/contracts/api';
import { errorMessage, unknownOutcome } from '../app/api.js';

export interface EditorField { name: string; label: string; value: string; pattern?: string; help?: string; required?: boolean; options?: readonly string[] }
export interface EditorIntent {
  title: string;
  path: string;
  fields: EditorField[];
  submit: (values: Readonly<Record<string, string>>, requestId: string) => Promise<ApiClientResult<unknown>>;
  refresh: () => Promise<unknown>;
}
interface EditorContextValue { open: (intent: EditorIntent) => void; busy: boolean }
const EditorContext = createContext<EditorContextValue | null>(null);
export function useEditor() {
  const editor = useContext(EditorContext);
  if (!editor) throw new Error('Editor provider required');
  return editor;
}
export function EditorProvider({ children }: { children: ReactNode }) {
  const [intent, setIntent] = useState<EditorIntent | null>(null);
  return <EditorContext.Provider value={{ open: setIntent, busy: !!intent }}>
    {children}
    {intent && <Editor key={intent.title + intent.path} intent={intent} close={() => setIntent(null)} />}
  </EditorContext.Provider>;
}
interface Attempt { requestId: string; values: Readonly<Record<string, string>> }
function initialValues(fields: EditorField[]) {
  return Object.fromEntries(fields.map(field => [field.name, field.value]));
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
  async function send(replay: boolean) {
    const next = replay && attempt ? attempt : { requestId: crypto.randomUUID(), values: { ...values } };
    setAttempt(next);
    setPending(true);
    setFailure(null);
    let reply: ApiClientResult<unknown>;
    try { reply = await intent.submit(next.values, next.requestId); }
    catch { reply = { ok: false, error: { kind: 'transport' } }; }
    setPending(false);
    if (!reply.ok) { setFailure(reply.error); return; }
    setSaved(true);
    await intent.refresh();
  }
  if (saved) return <aside className="editor" role="status">Changes saved. <button onClick={close}>Close editor</button></aside>;
  if (location.pathname !== intent.path) return <aside className="draft-banner" role="status">
    Your {intent.title.toLowerCase()} draft is preserved. <Link to={intent.path}>Return to draft</Link>
  </aside>;
  return <section className="editor" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>{intent.title}</h2>
    <form onSubmit={event => { event.preventDefault(); void send(false); }}>
      <fieldset disabled={pending}>
        <legend className="sr-only">{intent.title}</legend>
        {intent.fields.map((field, index) => <div className="field" key={field.name}>
          <label htmlFor={`${id}-${field.name}`}>{field.label}</label>
          {field.options ? <select id={`${id}-${field.name}`} name={field.name} value={values[field.name] ?? ''}
            autoFocus={index === 0} required={field.required ?? true}
            onChange={event => { setValues({ ...values, [field.name]: event.target.value }); setFailure(null); setAttempt(null); }}>
            {field.options.map(option => <option key={option} value={option}>{option}</option>)}
          </select> : <input id={`${id}-${field.name}`} name={field.name} value={values[field.name] ?? ''}
            autoFocus={index === 0} required={field.required ?? true} maxLength={128} pattern={field.pattern}
            aria-describedby={field.help ? `${id}-${field.name}-help` : undefined}
            onChange={event => { setValues({ ...values, [field.name]: event.target.value }); setFailure(null); setAttempt(null); }} />}
          {field.help && <small id={`${id}-${field.name}-help`}>{field.help}</small>}
        </div>)}
        <div className="actions">
          <button className="primary" type="submit" disabled={!!unknown}>{pending ? 'Saving…' : 'Save'}</button>
          <button type="button" onClick={close}>Discard draft</button>
        </div>
      </fieldset>
    </form>
    {pending && <p role="status">Sending changes…</p>}
    {failure && <EditorFailure failure={failure} unknown={!!unknown} retry={() => void send(true)} refresh={intent.refresh} />}
  </section>;
}
function EditorFailure({ failure, unknown, retry, refresh }: {
  failure: ApiClientFailure; unknown: boolean; retry: () => void; refresh: () => Promise<unknown>;
}) {
  return <div role="alert" className="notice error">
    <p>{errorMessage(failure)}</p>
    {unknown && <><p>The outcome is unknown. Retry sends the identical request. Editing a field starts a new intent.</p>
      <button onClick={retry}>Retry identical request</button></>}
    {failure.protocol?.code === 'conflict' && <><p>Refresh to see the latest version. Your draft is preserved; discard and reopen it to use that version.</p>
      <button onClick={() => void refresh()}>Refresh latest version</button></>}
  </div>;
}
