import { useEffect, useRef, useState } from 'react';
import type { Run } from '@beetle/contracts/api';
import { useApi } from '../../../app/api.js';

/** Isolated, abortable conflict reads preserve the editor when the main query fails. */
export function useNoteConflict(run: Run) {
  const api = useApi();
  const { organizationId, workspaceId } = run.scope;
  const identity = `${organizationId}/${workspaceId}/${run.id}`;
  const [remote, setRemote] = useState<Run | null>(null);
  const [reading, setReading] = useState(false);
  const [readFailed, setReadFailed] = useState(false);
  const lease = useRef({ active: true, controller: new AbortController() });
  useEffect(() => {
    const owner = { active: true, controller: new AbortController() };
    lease.current = owner;
    setRemote(null);
    setReading(false);
    setReadFailed(false);
    return () => {
      owner.active = false;
      owner.controller.abort();
    };
  }, [api, identity]);
  async function readConflict(expected: number) {
    const owner = lease.current;
    owner.controller.abort();
    owner.controller = new AbortController();
    const signal = owner.controller.signal;
    setRemote(null);
    setReading(true);
    setReadFailed(false);
    try {
      const reply = await api.getRun({ params: { organizationId, workspaceId, runId: run.id }, signal });
      if (!owner.active || signal.aborted) return;
      if (reply.ok && newerNote(reply.value, run, expected)) setRemote(reply.value);
      else setReadFailed(true);
    } catch {
      if (owner.active && !signal.aborted) setReadFailed(true);
    } finally {
      if (owner.active && !signal.aborted) setReading(false);
    }
  }
  return { remote, setRemote, reading, readFailed, readConflict };
}

function newerNote(value: Run, run: Run, expected: number): boolean {
  return (
    value.id === run.id &&
    value.scope.organizationId === run.scope.organizationId &&
    value.scope.workspaceId === run.scope.workspaceId &&
    (value.noteVersion ?? 0) > expected
  );
}
