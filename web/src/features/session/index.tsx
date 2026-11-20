import { useEffect, useId, useState, useSyncExternalStore } from 'react';
import { App } from '../../app/App.js';
import { sessionAccess } from '../../app/session.js';
import { Button } from '../../components/Button.js';
import { SessionScreen } from './SessionScreen.js';
import { BrowserSessionGate } from './session.js';
import type { SessionOptions } from './session.js';
import './session.css';

/** The host provides a Router and a trusted same-origin service URL. */
export function SessionApp(options: SessionOptions) {
  const [gate] = useState(() => new BrowserSessionGate(options));
  const state = useSyncExternalStore(gate.subscribe, gate.getSnapshot);
  useEffect(() => {
    gate.start();
    return () => gate.stop();
  }, [gate]);
  if (state.kind === 'paired')
    return (
      <App
        key={state.generation}
        apiClient={state.client}
        inputTransfers={state.transfers}
        session={sessionAccess(state.session, gate.logout)}
      />
    );
  return (
    <SessionScreen state={state} address={new URL(options.baseUrl).host} check={gate.reconnect}>
      {state.kind === 'unpaired' && state.screen !== 'signed-out' && state.screen !== 'expired' && (
        <PairForm pair={gate.pair} />
      )}
    </SessionScreen>
  );
}
function PairForm({ pair }: { pair: (token: string) => void }) {
  const id = useId();
  const [token, setToken] = useState('');
  return (
    <form
      className="session-form"
      autoComplete="off"
      onSubmit={(event) => {
        event.preventDefault();
        const submitted = token;
        setToken('');
        pair(submitted);
      }}
    >
      <label htmlFor={id}>Pairing token</label>
      <input
        id={id}
        name="bootstrapToken"
        type="password"
        autoComplete="off"
        spellCheck={false}
        required
        minLength={43}
        maxLength={43}
        pattern="[A-Za-z0-9_-]{43}"
        value={token}
        aria-describedby={`${id}-help`}
        onChange={(event) => setToken(event.target.value)}
      />
      <Button variant="primary" type="submit">
        Pair
      </Button>
      <small id={`${id}-help`}>Lost it? The token is in Beetle’s startup output.</small>
    </form>
  );
}
