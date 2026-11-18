import type { ReactNode } from 'react';
import { Button } from '../../components/Button.js';
import { useSkin } from '../../components/ThemeSwitch.js';
import type { SessionState } from './session.js';
import './session.css';

type PendingSession = Exclude<SessionState, { kind: 'paired' }>;
const headings = {
  'signed-out': 'You are signed out',
  expired: 'Your session ended',
  'address-denied': 'Open Beetle from its own address',
  'pairing-failed': 'That token did not work',
  unreachable: 'Beetle is not answering',
  recovery: 'Check your session',
};
function title(state: PendingSession): string {
  if ('screen' in state && state.screen) return headings[state.screen];
  switch (state.kind) {
    case 'unpaired':
      return 'Pair this browser';
    case 'checking':
      return 'Connecting to Beetle';
    case 'pairing':
      return 'Pairing this browser';
    case 'logging-out':
      return 'Signing out';
    case 'unavailable':
      return 'Beetle is not answering';
  }
}

function SessionMessage({ state }: { state: PendingSession }) {
  const checking = state.kind === 'checking';
  return (
    <>
      {checking && (
        <p className="session-message">Connecting to Beetle and checking access before loading workspace data.</p>
      )}
      <p
        className={checking ? 'session-message session-pending' : 'session-message'}
        role={state.kind === 'unavailable' ? 'alert' : 'status'}
      >
        {checking && <span className="session-spinner" aria-hidden="true" />}
        {state.message}
      </p>
    </>
  );
}
function actionLabel(state: PendingSession): string | null {
  if ('screen' in state) {
    if (state.screen === 'signed-out' || state.screen === 'expired') return 'Reconnect';
    if (state.screen === 'recovery') return 'Check session status';
  }
  return state.kind === 'unavailable' ? 'Check session status' : null;
}

/** Shared layout for every session board; only verified gate state chooses a screen. */
export function SessionScreen({
  state,
  address,
  check,
  children,
}: {
  state: PendingSession;
  address: string;
  check: () => void;
  children?: ReactNode;
}) {
  useSkin();
  const action = actionLabel(state);
  return (
    <main className="session-page" id="main" tabIndex={-1}>
      <div className="session-column">
        <p className="session-brand">Beetle Lab</p>
        <section className="session-panel" aria-labelledby="session-title">
          <h1 id="session-title">{title(state)}</h1>
          <SessionMessage state={state} />
          {children}
          {action && (
            <Button variant={action === 'Reconnect' ? 'primary' : 'text'} onClick={check}>
              {action}
            </Button>
          )}
        </section>
        <p className="session-address">{address}</p>
      </div>
    </main>
  );
}
