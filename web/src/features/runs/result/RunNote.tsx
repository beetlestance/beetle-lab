import { useId, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { errorMessage, useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { Button } from '../../../components/Button.js';
import { useWrite } from './useWrite.js';

/** Run note (031 setRunNote): its own noteVersion; a stale edit is refused and re-read. */
export function RunNote({ run, readOnly }: { run: Run; readOnly: boolean }) {
  const api = useApi();
  const client = useQueryClient();
  const id = useId();
  const { organizationId, workspaceId } = run.scope;
  const write = useWrite(`${organizationId}/${workspaceId}/${run.id}/note`);
  const [draft, setDraft] = useState<string | null>(null);
  const [saved, setSaved] = useState<Run | null>(null);
  const current = saved && (saved.noteVersion ?? 0) > (run.noteVersion ?? 0) ? saved : run;
  const note = current.note ?? null;
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
        setSaved(next);
        setDraft(null);
        void client.invalidateQueries({ queryKey: runKey, exact: true });
        void client.invalidateQueries({ queryKey: [...queryKeys.runs(organizationId, workspaceId), 'page'] });
      },
      (failure) => {
        if (failure.failure.protocol?.code === 'conflict')
          void client.invalidateQueries({ queryKey: runKey, exact: true });
      },
    );
  }
  const trimmed = draft?.trim() ?? '';
  const conflict = write.error?.failure.protocol?.code === 'conflict';
  return (
    <section className="result-note" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`} className="result-note-title">
        Note
      </h2>
      {draft === null ? (
        <div className="result-note-view">
          <p className={note ? 'result-note-text' : 'result-muted'}>{note ?? 'No note on this run.'}</p>
          {!readOnly && (
            <Button variant="text" size="sm" onClick={() => setDraft(note ?? '')}>
              {note ? 'Edit note' : 'Add a note'}
            </Button>
          )}
        </div>
      ) : (
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
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!trimmed}
              loading={write.pending}
              loadingLabel="Saving…"
            >
              Save note
            </Button>
            {note && (
              <Button size="sm" disabled={write.pending} onClick={() => save(null)}>
                Clear note
              </Button>
            )}
            <Button variant="text" size="sm" disabled={write.pending} onClick={() => setDraft(null)}>
              Cancel
            </Button>
          </div>
        </form>
      )}
      {write.error && (
        <p role="alert" className="result-inline-error">
          {conflict
            ? 'The note changed elsewhere. The latest note is shown; edit again to replace it.'
            : errorMessage(write.error.failure)}
          {write.error.unknown && (
            <>
              {' '}
              The outcome is unknown.{' '}
              <Button variant="text" size="sm" onClick={write.retry} disabled={write.pending}>
                Retry the same save
              </Button>
            </>
          )}
        </p>
      )}
    </section>
  );
}
