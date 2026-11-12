import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { App } from '../../app/App.js';
import { ThemePicker } from '../../components/ThemePicker.js';
import { BrowserSessionGate } from './session.js';
import type { SessionOptions } from './session.js';
import './session.css';

/** The host provides a Router and a trusted same-origin service URL. */
export function SessionApp(options: SessionOptions) {
  const [gate] = useState(() => new BrowserSessionGate(options));
  const state = useSyncExternalStore(gate.subscribe, gate.getSnapshot);
  useEffect(() => { gate.start(); return () => gate.stop(); }, [gate]);
  if (state.kind === 'paired') return <>
    <div className="session-toolbar" aria-label="Local session">
      <span>Local administrator · expires <time dateTime={state.session.expiresAt}>{state.session.expiresAt} UTC</time></span>
      <button onClick={gate.logout}>Sign out</button>
    </div>
    <App key={state.generation} apiClient={state.client} inputTransfers={state.transfers} />
  </>;
  return <main className="session-page" id="main" tabIndex={-1}>
    <section className="session-panel" aria-labelledby="session-title">
      <header><p>Beetle Lab · Local access</p><h1 id="session-title">{state.kind === 'unpaired' ? 'Pair this browser' : 'Local access'}</h1></header>
      <p role={state.kind === 'unavailable' ? 'alert' : 'status'}>{state.message}</p>
      {state.kind === 'unpaired' && <PairForm pair={gate.pair} />}
      {(state.kind === 'unavailable' || state.kind === 'unpaired') && <button onClick={gate.check}>Check session status</button>}
      <ThemePicker />
    </section>
  </main>;
}
function PairForm({ pair }: { pair: (token: string) => void }) {
  const id = useId();
  const [token, setToken] = useState('');
  return <form className="session-form" autoComplete="off" onSubmit={event => {
    event.preventDefault();
    const submitted = token;
    setToken('');
    pair(submitted);
  }}>
    <label htmlFor={id}>Startup token</label>
    <input id={id} name="bootstrapToken" type="password" autoComplete="off" spellCheck={false}
      required minLength={43} maxLength={43} pattern="[A-Za-z0-9_-]{43}" value={token}
      aria-describedby={`${id}-help`} onChange={event => setToken(event.target.value)} />
    <small id={`${id}-help`}>Enter the one-time token from the local service’s startup output.</small>
    <button className="primary" type="submit">Pair browser</button>
  </form>;
}
