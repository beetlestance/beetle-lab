import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { Run } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';
import { queryKeys } from '../../../app/queries.js';
import { useWrite } from './useWrite.js';
import { useNoteConflict } from './useNoteConflict.js';

/** A conflict read belongs to this editor, so a failed refresh cannot unmount its draft. */
export function useRunNote(run: Run, saved: () => void) {
  const api = useApi();
  const client = useQueryClient();
  const { organizationId, workspaceId } = run.scope;
  const identity = `${organizationId}/${workspaceId}/${run.id}/note`;
  const write = useWrite(identity);
  const [latest, setLatest] = useState<Run | null>(null);
  const [attempted, setAttempted] = useState<string | null>(null);
  const conflict = useNoteConflict(run);
  const { remote, setRemote, readConflict } = conflict;
  const current =
    latest &&
    latest.id === run.id &&
    latest.scope.organizationId === organizationId &&
    latest.scope.workspaceId === workspaceId &&
    (latest.noteVersion ?? 0) > (run.noteVersion ?? 0)
      ? latest
      : run;
  const rejectedVersion = useRef(0);
  function save(value: string | null, base = current) {
    const captured = {
      scope: run.scope,
      requestId: crypto.randomUUID(),
      expectedNoteVersion: base.noteVersion ?? 0,
      note: value,
    };
    setAttempted(value);
    setRemote(null);
    write.start(
      (signal) => api.setRunNote({ params: { organizationId, workspaceId, runId: run.id }, body: captured, signal }),
      (next) => {
        setLatest(next);
        saved();
        void client.invalidateQueries({ queryKey: queryKeys.run(organizationId, workspaceId, run.id), exact: true });
        void client.invalidateQueries({ queryKey: [...queryKeys.runs(organizationId, workspaceId), 'page'] });
      },
      (failure) => {
        if (failure.failure.protocol?.code === 'conflict') {
          rejectedVersion.current = captured.expectedNoteVersion;
          void readConflict(captured.expectedNoteVersion);
        }
      },
    );
  }
  function useTheirs() {
    if (!remote || write.pending) return;
    setLatest(remote);
    setRemote(null);
    write.dismiss();
    saved();
  }
  return {
    current,
    attempted,
    write,
    save,
    remote,
    reading: conflict.reading,
    readFailed: conflict.readFailed,
    useTheirs,
    retryRead: () => void readConflict(rejectedVersion.current),
  };
}
