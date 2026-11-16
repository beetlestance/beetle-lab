import { useEffect, useId, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import type { SuiteRevision, WorkspaceSettings } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import { QueryState } from '../../components/QueryState.js';
import { budgetFields, captureRequest, initialValues } from '../execution-request/index.js';
import { useSubmission } from './useSubmission.js';
import './runs.css';

export function RunSavedRevision({ revision }: { revision: SuiteRevision }) {
  return <RevisionLauncher key={`${revision.scope.organizationId}/${revision.scope.workspaceId}/${revision.id}`} revision={revision} />;
}
function RevisionLauncher({ revision }: { revision: SuiteRevision }) {
  const [open, setOpen] = useState(false);
  const launcher = useRef<HTMLButtonElement>(null);
  return <div className="run-launcher">
    <button ref={launcher} disabled={open} onClick={() => setOpen(true)}>Run saved revision</button>
    {open && <SubmissionSettings revision={revision} close={() => { setOpen(false); queueMicrotask(() => launcher.current?.focus()); }} />}
  </div>;
}
function SubmissionSettings({ revision, close }: { revision: SuiteRevision; close: () => void }) {
  const api = useApi(); const client = useQueryClient();
  const { organizationId, workspaceId } = revision.scope;
  const queryKey = queryKeys.workspaceSettings(organizationId, workspaceId);
  const query = useQuery({ queryKey, queryFn: ({ signal }) => readResult(api.getWorkspaceSettings({ params: { organizationId, workspaceId }, signal })) });
  useEffect(() => () => {
    void client.cancelQueries({ queryKey, type: 'inactive' }); client.removeQueries({ queryKey, type: 'inactive' });
  }, [client, organizationId, workspaceId]);
  // A background settings failure must not retire an unresolved original intent.
  return query.data ? <SubmissionForm revision={revision} settings={query.data} close={close} />
    : <><QueryState query={query}>{() => null}</QueryState><button onClick={close}>Close run form</button></>;
}
function SubmissionForm({ revision, settings, close }: { revision: SuiteRevision; settings: WorkspaceSettings; close: () => void }) {
  const id = useId();
  const [values, setValues] = useState(() => initialValues(settings));
  const [error, setError] = useState<string | null>(null);
  const alert = useRef<HTMLDivElement>(null);
  const submit = useSubmission();
  const locked = submit.pending || submit.unknown;
  useEffect(() => { if (error || submit.message) alert.current?.focus(); }, [error, submit.message]);
  function send() {
    if (locked) return;
    try {
      const body = captureRequest({ revision, settings, values, requestId: crypto.randomUUID() });
      setError(null); void submit.send(body);
    } catch (failure) { setError(failure instanceof Error ? failure.message : 'Check the entered values.'); }
  }
  return <section className="editor run-form" aria-labelledby={`${id}-title`}>
    <h2 id={`${id}-title`}>Submit saved revision {revision.ordinal}</h2>
    <p className="number">{revision.id}</p><p>The saved revision is immutable. Engine validation remains pending after queueing.</p>
    <form onSubmit={event => { event.preventDefault(); send(); }}><fieldset disabled={locked}>
      <legend className="sr-only">Run settings</legend>
      <label className="field">Engine profile<select autoFocus value={values.profile}
        onChange={event => setValues({ ...values, profile: event.target.value })}>
        {settings.effective.runDefaults.engineProfile.allowedValues.map(profile => <option key={profile}>{profile}</option>)}
      </select></label>
      {budgetFields.map(([key, label]) => { const range = settings.effective.runDefaults.budget[key].allowedRange;
        return <div className="field" key={key}><label htmlFor={`${id}-${key}`}>{label}</label><input id={`${id}-${key}`} value={values.budget[key]} inputMode="numeric" required maxLength={16}
          aria-describedby={`${id}-${key}-help`} onChange={event => setValues({ ...values, budget: { ...values.budget, [key]: event.target.value } })} />
          <small id={`${id}-${key}-help`}>Whole number: {range.minimum}–{range.maximum}.</small></div>;
      })}
      <label className="field">Execution mode<select value={values.mode}
        onChange={event => { if (event.target.value === 'parallel' || event.target.value === 'isolated') setValues({ ...values, mode: event.target.value }); }}>
        <option value="parallel">Parallel</option><option value="isolated">Isolated</option>
      </select></label>
      <label className="run-checkbox"><input type="checkbox" checked={values.preferIdle}
        onChange={event => setValues({ ...values, preferIdle: event.target.checked })} />Prefer idle capacity</label>
      <button className="primary" type="submit">Submit run</button>
    </fieldset></form>
    {submit.pending && <div role="status"><p>Submitting run…</p><button onClick={submit.cancel}>Interrupt request</button></div>}
    {(error || submit.message) && <div className="notice error" role="alert" tabIndex={-1} ref={alert}>
      <p>{error ?? submit.message}</p>
      {submit.unknown && <button disabled={submit.pending} onClick={() => void submit.send()}>Replay original request</button>}
    </div>}
    <div className="actions"><Link to={routes.runs(revision.scope.organizationId, revision.scope.workspaceId)}>Check run history</Link>
      <button disabled={locked} onClick={close}>Close run form</button></div>
  </section>;
}
