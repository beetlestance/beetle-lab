import { useSessionAccess } from '../../app/session.js';
import { useId } from 'react';
import type { ApiClientFailure } from '@beetle/contracts/api';
import { errorMessage } from '../../app/api.js';
import { Button } from '../../components/Button.js';
import { TextInput } from '../../components/Fields.js';
import type { Config } from '../suites/draft.js';
import { problemContext } from './problem-context.js';
import './save-errors.css';
import type { Problem } from './problems.js';

export type SaveState = {
  pending: boolean;
  unknown: boolean;
  failure: ApiClientFailure | null;
  replay: () => void;
  newIntent: () => void;
};

export function ProblemList({
  problems,
  jump,
  config,
  embedded = false,
}: {
  problems: readonly Problem[];
  jump: (path: string) => void;
  config?: Config | null;
  embedded?: boolean;
}) {
  if (!problems.length) return null;
  return (
    <div className="save-problems" role="alert">
      {!embedded && (
        <p className="save-problems-title">
          Fix {problems.length} {problems.length === 1 ? 'thing' : 'things'} before saving
        </p>
      )}
      <ul>
        {problems.map((problem, index) => (
          <li key={`${problem.path}-${index}`}>
            <button
              type="button"
              className="problem-link"
              aria-label={problem.message}
              onClick={() => jump(problem.path)}
            >
              {embedded && <span className="problem-context">{problemContext(problem.path, config ?? null)}</span>}
              <span>{problem.message}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Outcome of the last save: done, a plain failure, or an unknown outcome with replay. */
function SaveOutcome({ write, saved }: { write: SaveState; saved: number | null }) {
  const failure = write.failure;
  if (!failure)
    return saved !== null && !write.pending ? (
      <p role="status" className="save-done">
        Saved as revision {saved}.
      </p>
    ) : null;
  if (write.unknown)
    return (
      <div role="alert" className="save-unknown">
        <p>{errorMessage(failure)} The outcome is unknown. Retry sends the identical request, including its version.</p>
        <div className="save-actions">
          <Button variant="secondary" size="sm" onClick={write.replay}>
            Retry identical request
          </Button>
          <Button variant="text" size="sm" onClick={write.newIntent}>
            Start new intent with this draft
          </Button>
        </div>
      </div>
    );
  if (failure.protocol?.code === 'conflict' || failure.protocol?.fields.length) return null;
  return (
    <p role="alert" className="field-error">
      {errorMessage(failure)} Your draft is kept.
    </p>
  );
}

type SavePanelProps = {
  next: number;
  message: string;
  setMessage: (message: string) => void;
  messageError: string;
  dirty: boolean;
  blocked: boolean;
  problems: readonly Problem[];
  config: Config | null;
  write: SaveState;
  saved: number | null;
  save: () => void;
  discard: () => void;
  jump: (path: string) => void;
};

/** "Panel / Save revision" and its Errors state: message, save, discard, and every blocker with jump-to. */
export function SavePanel({
  next,
  message,
  setMessage,
  messageError,
  dirty,
  blocked,
  problems,
  config,
  write,
  saved,
  save,
  discard,
  jump,
}: SavePanelProps) {
  const titleId = useId();
  const { readOnly } = useSessionAccess();
  const locked = readOnly || write.pending || write.unknown;
  const errors = problems.length > 0 && !write.unknown && !write.pending;
  return (
    <section className={`save-panel ${errors ? 'save-panel-errors' : ''}`} aria-labelledby={titleId}>
      <h2 id={titleId}>{saveHeading(errors, next, problems.length)}</h2>
      <p className="editor-note">
        {errors
          ? 'Nothing is saved until all of these are fixed.'
          : 'Revisions never change after saving. Past runs keep pointing at the revision they used.'}
      </p>
      <ProblemList problems={problems} jump={jump} config={config} embedded={errors} />
      <SaveMessage {...{ errors, message, messageError, problems, locked, setMessage }} />
      {errors && <p className="problem-jump-hint">Select one to jump to the field.</p>}
      <SaveActions {...{ write, blocked, locked, dirty, save, discard }} />
      <SaveOutcome write={write} saved={saved} />
    </section>
  );
}

function saveHeading(errors: boolean, next: number, count: number) {
  return errors ? `Fix ${count} ${count === 1 ? 'thing' : 'things'} to save` : `Save as revision ${next}`;
}

function SaveMessage({
  errors,
  message,
  messageError,
  problems,
  locked,
  setMessage,
}: Pick<SavePanelProps, 'message' | 'messageError' | 'problems' | 'setMessage'> & {
  errors: boolean;
  locked: boolean;
}) {
  if (errors && !message && !messageError && !problems.some((problem) => problem.path === '/message')) return null;
  return (
    <TextInput
      label="What changed"
      placeholder="For example: raised the rate to 1,500"
      maxLength={280}
      value={message}
      error={messageError || undefined}
      disabled={locked}
      onChange={(event) => setMessage(event.target.value)}
    />
  );
}

function SaveActions({
  write,
  blocked,
  locked,
  dirty,
  save,
  discard,
}: Pick<SavePanelProps, 'write' | 'blocked' | 'dirty' | 'save' | 'discard'> & { locked: boolean }) {
  return (
    <div className="save-actions">
      <Button
        variant="primary"
        loading={write.pending}
        loadingLabel="Saving…"
        disabled={blocked || locked || !dirty}
        onClick={save}
      >
        Save revision
      </Button>
      <Button variant="text" disabled={!dirty || locked} onClick={discard}>
        Discard changes
      </Button>
    </div>
  );
}
