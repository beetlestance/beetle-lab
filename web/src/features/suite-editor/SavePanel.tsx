import { useSessionAccess } from '../../app/session.js';
import { useId } from 'react';
import type { ApiClientFailure } from '@beetle/contracts/api';
import { errorMessage } from '../../app/api.js';
import { Button } from '../../components/Button.js';
import { TextInput } from '../../components/Fields.js';
import type { Problem } from './problems.js';

export type SaveState = {
  pending: boolean;
  unknown: boolean;
  failure: ApiClientFailure | null;
  replay: () => void;
  newIntent: () => void;
};

function ProblemList({ problems, jump }: { problems: readonly Problem[]; jump: (path: string) => void }) {
  if (!problems.length) return null;
  return (
    <div className="save-problems" role="alert">
      <p className="save-problems-title">
        Fix {problems.length} {problems.length === 1 ? 'thing' : 'things'} before saving
      </p>
      <ul>
        {problems.map((problem, index) => (
          <li key={`${problem.path}-${index}`}>
            <button type="button" className="problem-link" onClick={() => jump(problem.path)}>
              {problem.message}
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

/** "Panel / Save revision" and its Errors state: message, save, discard, and every blocker with jump-to. */
export function SavePanel({
  next,
  message,
  setMessage,
  messageError,
  dirty,
  blocked,
  problems,
  write,
  saved,
  save,
  discard,
  jump,
}: {
  next: number;
  message: string;
  setMessage: (message: string) => void;
  messageError: string;
  dirty: boolean;
  blocked: boolean;
  problems: readonly Problem[];
  write: SaveState;
  saved: number | null;
  save: () => void;
  discard: () => void;
  jump: (path: string) => void;
}) {
  const titleId = useId();
  const { readOnly } = useSessionAccess();
  const locked = readOnly || write.pending || write.unknown;
  return (
    <section className="save-panel" aria-labelledby={titleId}>
      <h2 id={titleId}>Save as revision {next}</h2>
      <p className="editor-note">
        Revisions never change after saving. Past runs keep pointing at the revision they used.
      </p>
      <ProblemList problems={problems} jump={jump} />
      <TextInput
        label="What changed"
        placeholder="For example: raised the rate to 1,500"
        maxLength={280}
        value={message}
        error={messageError || undefined}
        disabled={locked}
        onChange={(event) => setMessage(event.target.value)}
      />
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
      <SaveOutcome write={write} saved={saved} />
    </section>
  );
}
