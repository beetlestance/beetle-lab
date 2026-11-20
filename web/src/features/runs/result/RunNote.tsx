import { useId, useState } from 'react';
import type { Run } from '@beetle/contracts/api';
import { errorMessage } from '../../../app/api.js';
import { Button } from '../../../components/Button.js';
import { useRunNote } from './useRunNote.js';

type Write = ReturnType<typeof useRunNote>['write'];

export function useResultNote(run: Run) {
  const [draft, setDraft] = useState<string | null>(null);
  const [base, setBase] = useState<Run | null>(null);
  const editor = useRunNote(run, () => setDraft(null));
  return { draft, setDraft, base, setBase, editor };
}

/** Run note (031 setRunNote): its own noteVersion; a stale edit is refused and re-read. */
export function RunNote({ state, readOnly }: { state: ReturnType<typeof useResultNote>; readOnly: boolean }) {
  const id = useId();
  const { draft, setDraft, base, setBase, editor } = state;
  const { current, write, save } = editor;
  const note = current.note ?? null;
  const conflict = write.error?.failure.protocol?.code === 'conflict';
  const locked = noteLocked(write, conflict);
  return (
    <section className="run-note" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="sr-only">
        Note
      </h2>
      {draft === null || readOnly ? (
        <NoteView
          note={note}
          updatedAt={current.noteUpdatedAt ?? null}
          readOnly={readOnly}
          edit={() => {
            setBase(current);
            setDraft(note ?? '');
          }}
        />
      ) : (
        <NoteForm
          id={id}
          draft={draft}
          note={note}
          pending={write.pending}
          locked={locked}
          setDraft={setDraft}
          save={(value) => save(value, base ?? current)}
        />
      )}
      {write.error && <NoteError write={write} error={write.error} />}
      {conflict && !readOnly && <NoteConflict editor={editor} />}
    </section>
  );
}

function NoteView({
  note,
  updatedAt,
  readOnly,
  edit,
}: {
  note: string | null;
  updatedAt?: string | null;
  readOnly: boolean;
  edit: () => void;
}) {
  return (
    <div className="run-note-view">
      {(note || readOnly) && (
        <p className={note ? 'run-note-text' : 'result-muted'}>{note ?? 'No note on this run.'}</p>
      )}
      {note && (
        <small className="result-muted">
          Note ·{' '}
          {updatedAt ? <time dateTime={updatedAt}>edited {noteEditLabel(updatedAt)}</time> : 'edit time not recorded'}
        </small>
      )}
      {!readOnly && (
        <Button variant="text" size="sm" onClick={edit}>
          {!note && <span aria-hidden="true">+ </span>}
          {note ? 'Edit note' : 'Add a note'}
        </Button>
      )}
    </div>
  );
}

function NoteForm({
  id,
  draft,
  note,
  pending,
  locked,
  setDraft,
  save,
}: {
  id: string;
  draft: string;
  note: string | null;
  pending: boolean;
  locked: boolean;
  setDraft: (value: string | null) => void;
  save: (value: string | null) => void;
}) {
  const trimmed = draft.trim();
  return (
    <form
      className="run-note-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed && !locked) save(trimmed);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Run note
      </label>
      <textarea
        id={id}
        className="input run-note-input"
        value={draft}
        readOnly={locked}
        maxLength={1000}
        rows={3}
        placeholder="What changed, what you were testing, what to remember"
        onChange={(event) => setDraft(event.target.value)}
      />
      <div className="run-note-footer">
        <small className="result-muted">{draft.length.toLocaleString()} / 1,000</small>
        <div className="result-row">
          {note && (
            <Button size="sm" disabled={locked} onClick={() => save(null)}>
              Clear note
            </Button>
          )}
          <Button variant="text" size="sm" disabled={locked} onClick={() => setDraft(null)}>
            Cancel
          </Button>
          <Button
            type="submit"
            variant="primary"
            size="sm"
            disabled={!trimmed || locked}
            loading={pending}
            loadingLabel="Saving note…"
          >
            Save note
          </Button>
        </div>
      </div>
    </form>
  );
}

function NoteError({ write, error }: { write: Write; error: NonNullable<Write['error']> }) {
  const conflict = error.failure.protocol?.code === 'conflict';
  return (
    <p role="alert" className="result-inline-error">
      {conflict
        ? 'The note changed elsewhere. Your draft is kept. Choose which note to keep after reading the latest version.'
        : errorMessage(error.failure)}
      {error.unknown && (
        <>
          {' '}
          The outcome is unknown.{' '}
          <Button variant="text" size="sm" onClick={write.retry} disabled={write.pending}>
            Retry the same save
          </Button>
        </>
      )}
    </p>
  );
}

function NoteConflict({ editor }: { editor: ReturnType<typeof useRunNote> }) {
  return (
    <div className="run-note-conflict">
      {editor.reading && <p role="status">Reading the latest note…</p>}
      {editor.readFailed && (
        <p role="alert">
          Could not read the changed note. Your draft is kept.
          <Button size="sm" onClick={editor.retryRead}>
            Read latest note
          </Button>
        </p>
      )}
      {editor.remote && (
        <>
          <p>Latest note: {editor.remote.note ?? 'No note'}</p>
          <div className="result-row">
            <Button size="sm" onClick={editor.useTheirs}>
              Use theirs
            </Button>
            <Button size="sm" variant="primary" onClick={() => editor.save(editor.attempted, editor.remote!)}>
              Replace with mine
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function noteLocked(write: Write, conflict: boolean): boolean {
  return write.pending || write.error?.unknown === true || conflict;
}

function noteEditLabel(stamp: string): string {
  const date = new Date(stamp);
  const day = date.toDateString() === new Date().toDateString() ? 'today' : date.toLocaleDateString();
  return `${day}, ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}`;
}
