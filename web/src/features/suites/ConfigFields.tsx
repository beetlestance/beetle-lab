import { useEffect, useState } from 'react';
import { SUITE_MAXIMUM_CONFIG_BYTES } from '@beetle/contracts/api';
import { draftText, parseDraft, updatePart } from './draft.js';
import type { Config } from './draft.js';

export function ConfigFields({ text, change, disabled, validity }: { text: string; change: (text: string) => void; disabled: boolean; validity: (invalid: boolean) => void }) {
  const [intakeError, setIntakeError] = useState('');
  function editJson(next: string) {
    if (next.length > SUITE_MAXIMUM_CONFIG_BYTES) { setIntakeError('Text exceeds 1 MiB characters; previous draft retained.'); validity(true); return; }
    setIntakeError(''); validity(false); change(next);
  }
  const [invalid, setInvalid] = useState<Record<string, boolean>>({});
  function partValidity(key: string, bad: boolean) {
    const next = { ...invalid, [key]: bad }; setInvalid(next); validity(Object.values(next).some(Boolean));
  }
  function apply(key: string, value: unknown) {
    try { change(updatePart(text, key, value)); setIntakeError(''); validity(Object.values(invalid).some(Boolean)); }
    catch (caught) { setIntakeError((caught as Error).message); validity(true); }
  }
  const [mode, setMode] = useState<'form' | 'json'>('form');
  let config: Config = {};
  let error = '';
  try { config = parseDraft(text); } catch (caught) { error = (caught as Error).message; }
  return <div className="suite-config">
    <div className="actions" role="group" aria-label="Configuration editor mode">
      <button type="button" aria-pressed={mode === 'form'} disabled={disabled || !!error || !!intakeError} onClick={() => setMode('form')}>Form editor</button>
      <button type="button" aria-pressed={mode === 'json'} disabled={disabled || Object.values(invalid).some(Boolean)} onClick={() => setMode('json')}>JSON editor</button>
    </div>
    {(error || intakeError) && <p role="alert">{error || intakeError}</p>}
    {mode === 'json' ? <label>Complete configuration JSON<textarea autoFocus aria-label="Complete configuration JSON" disabled={disabled}
      value={text} onChange={event => editJson(event.target.value)} spellCheck={false} /></label>
      : <fieldset disabled={disabled}><legend>Configuration</legend>
        <label>Target URL<input aria-label="Target URL" value={typeof config.target === 'string' ? config.target : ''}
          onChange={event => apply('target', event.target.value)} /></label>
        <LoadControls config={config} apply={apply} />
        <RequestControls config={config} apply={apply} />
        <JsonPart key={`requests-${mode}`} label="Requests JSON" validity={bad => partValidity('requests', bad)} value={config.requests} apply={value => apply('requests', value)} />
        <JsonPart label="Load plan JSON" validity={bad => partValidity('loadPlan', bad)} value={config.loadPlan} apply={value => apply('loadPlan', value)} />
        <p>Advanced fields, including selections, dataset input references and opaque secret references, remain in complete JSON. Input upload and run validation are separate steps.</p>
      </fieldset>}
  </div>;
}
function JsonPart({ label, value, apply, validity }: { label: string; value: unknown; apply: (value: unknown) => void; validity: (invalid: boolean) => void }) {
  const [text, setText] = useState(() => value === undefined ? 'null' : draftText(value));
  const [error, setError] = useState('');
  const canonical = value === undefined ? 'null' : draftText(value);
  useEffect(() => { setText(canonical); }, [canonical]);
  return <label>{label}<textarea aria-label={label} value={text} spellCheck={false} onChange={event => {
    const next = event.target.value;
    if (next.length > SUITE_MAXIMUM_CONFIG_BYTES) { setError('Text exceeds 1 MiB characters; previous field retained.'); validity(true); return; }
    setText(next);
    try { const wrapped = parseDraft(`{"part":${next}}`); apply(wrapped.part); setError(''); validity(false); }
    catch (caught) { setError((caught as Error).message); validity(true); }
  }} />{error && <span role="alert">{error} Correct this field before leaving the form.</span>}</label>;
}

function RequestControls({ config, apply }: { config: Config; apply: (key: string, value: unknown) => void }) {
  if (!Array.isArray(config.requests)) return null;
  return <div>{config.requests.slice(0, 100).map((request: unknown, index) => {
    if (request === null || typeof request !== 'object' || Array.isArray(request)) return null;
    const row = request as Record<string, unknown>;
    function update(key: string, value: string) {
      const requests = [...config.requests as unknown[]]; requests[index] = { ...row, [key]: value };
      apply('requests', requests);
    }
    return <fieldset key={index}><legend>Request {index + 1}</legend>
      <label>Method<input aria-label={`Request ${index + 1} method`} value={typeof row.method === 'string' ? row.method : ''}
        onChange={event => update('method', event.target.value)} /></label>
      <label>Path<input aria-label={`Request ${index + 1} path`} value={typeof row.path === 'string' ? row.path : ''}
        onChange={event => update('path', event.target.value)} /></label>
    </fieldset>;
  })}</div>;
}

function LoadControls({ config, apply }: { config: Config; apply: (key: string, value: unknown) => void }) {
  const plan = config.loadPlan;
  if (!plan || typeof plan !== 'object' || Array.isArray(plan)) return null;
  const loadPlan = plan as Record<string, unknown>;
  if (!Array.isArray(loadPlan.scenarios)) return null;
  return <div>{loadPlan.scenarios.slice(0, 100).map((scenario: unknown, index) => {
    if (!scenario || typeof scenario !== 'object' || Array.isArray(scenario)) return null;
    const row = scenario as Record<string, unknown>;
    function update(executor: string) {
      const scenarios = [...loadPlan.scenarios as unknown[]]; scenarios[index] = { ...row, executor };
      apply('loadPlan', { ...loadPlan, scenarios });
    }
    return <label key={index}>Scenario {index + 1} executor<input aria-label={`Scenario ${index + 1} executor`}
      value={typeof row.executor === 'string' ? row.executor : ''} onChange={event => update(event.target.value)} /></label>;
  })}<p>First 100 request/scenario controls are shown. Complete lists and executor parameters are editable in structured JSON.</p></div>;
}
