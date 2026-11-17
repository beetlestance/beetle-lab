import { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { errorMessage, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { Button } from '../../../components/Button.js';
import { useWrite } from './useWrite.js';

type Write = ReturnType<typeof useWrite>;

/** Run note (031 setRunNote): its own noteVersion; a stale edit is refused and re-read. */
export function RunNote({ run, readOnly }: { run: Run; readOnly: boolean }) {
  const id = useId();
  const [draft, setDraft] = useState<string | null>(null);
  const { note, write, save } = useNoteSave(run, () => setDraft(null));
  return (
    <section className="result-note" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="result-note-title">
        Note
      </h2>
      {draft === null ? (
        <NoteView note={note} readOnly={readOnly} edit={() => setDraft(note ?? '')} />
      ) : (
        <NoteForm id={id} draft={draft} note={note} pending={write.pending} setDraft={setDraft} save={save} />
      )}
      {write.error && <NoteError write={write} error={write.error} />}
    </section>
  );
}

/** The newer of the read and the last saved run, and a save that keeps both caches honest. */
function useNoteSave(run: Run, saved: () => void) {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = run.scope;
  const write = useWrite(`${organizationId}/${workspaceId}/${run.id}/note`);
  const [latest, setLatest] = useState<Run | null>(null);
  const current = latest && (latest.noteVersion ?? 0) > (run.noteVersion ?? 0) ? latest : run;
  const body = useRef<Parameters<typeof api.setRunNote>[0]['body'] | null>(null);
  const runKey = queryKeys.run(organizationId, workspaceId, run.id);
  function save(value: string | null) {
    body.current = {
      scope: run.scope,
      requestId: crypto.randomUUID(),
      expectedNoteVersion: current.noteVersion ?? 0,
      note: value,
    };
    const captured = body.current;
    write.start(
      (signal) => api.setRunNote({ params: { organizationId, workspaceId, runId: run.id }, body: captured, signal }),
      (next) => {
        setLatest(next);
        saved();
        void client.invalidateQueries({ queryKey: runKey, exact: true });
        void client.invalidateQueries({ queryKey: [...queryKeys.runs(organizationId, workspaceId), 'page'] });
      },
      (failure) => {
        if (failure.failure.protocol?.code === 'conflict')
          void client.invalidateQueries({ queryKey: runKey, exact: true });
      },
    );
  }
  return { note: current.note ?? null, write, save };
}

function NoteView({ note, readOnly, edit }: { note: string | null; readOnly: boolean; edit: () => void }) {
  return (
    <div className="result-note-view">
      <p className={note ? 'result-note-text' : 'result-muted'}>{note ?? 'No note on this run.'}</p>
      {!readOnly && (
        <Button variant="text" size="sm" onClick={edit}>
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
  setDraft,
  save,
}: {
  id: string;
  draft: string;
  note: string | null;
  pending: boolean;
  setDraft: (value: string | null) => void;
  save: (value: string | null) => void;
}) {
  const trimmed = draft.trim();
  return (
    <form
      className="result-note-form"
      onSubmit={(event) => {
        event.preventDefault();
        if (trimmed) save(trimmed);
      }}
    >
      <label className="sr-only" htmlFor={id}>
        Run note
      </label>
      <textarea
        id={id}
        className="input result-note-input"
        value={draft}
        maxLength={1000}
        rows={3}
        placeholder="What changed, what you were testing, what to remember"
        onChange={(event) => setDraft(event.target.value)}
      />
      <small className="result-muted">{draft.length} / 1000. Notes are searchable from Runs.</small>
      <div className="result-row">
        <Button type="submit" variant="primary" size="sm" disabled={!trimmed} loading={pending} loadingLabel="Saving…">
          Save note
        </Button>
        {note && (
          <Button size="sm" disabled={pending} onClick={() => save(null)}>
            Clear note
          </Button>
        )}
        <Button variant="text" size="sm" disabled={pending} onClick={() => setDraft(null)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

function NoteError({ write, error }: { write: Write; error: NonNullable<Write['error']> }) {
  const conflict = error.failure.protocol?.code === 'conflict';
  return (
    <p role="alert" className="result-inline-error">
      {conflict
        ? 'The note changed elsewhere. The latest note is shown; edit again to replace it.'
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
