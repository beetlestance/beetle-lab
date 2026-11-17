import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApiClientFailure, ApiClientResult, InstallationPatch, ScopedOverridePatch } from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';
import type { SettingsData } from './intents.js';
import { writeSettings } from './intents.js';
import type { Draft, DraftValue } from './model.js';

type Patch = InstallationPatch | ScopedOverridePatch;
interface Attempt {
  requestId: string;
  data: SettingsData;
  patch: Patch;
}
export type SavePhase =
  | { phase: 'idle' }
  | { phase: 'pending' }
  | { phase: 'failed'; failure: ApiClientFailure; attempt: Attempt }
  | { phase: 'saved' };

/**
 * Unsaved changes for one settings level. The draft lives in the query client under its
 * own key, so leaving the page and coming back keeps it until it is saved or discarded.
 */
export function useDraft(key: readonly string[]) {
  const client = useQueryClient();
  const draftKey = ['settings-draft', ...key];
  const [draft, setDraftState] = useState<Draft>(() => client.getQueryData<Draft>(draftKey) ?? {});
  const setDraft = (next: Draft) => {
    client.setQueryDefaults(draftKey, { gcTime: Infinity });
    client.setQueryData(draftKey, next);
    setDraftState(next);
  };
  return {
    draft,
    change: (id: string, value: DraftValue | undefined) => {
      const next: Record<string, DraftValue> = { ...draft };
      if (value) next[id] = value;
      else delete next[id];
      setDraft(next);
    },
    clear: () => setDraft({}),
  };
}

/** Save with one request ID per intent; only an unknown outcome offers the identical replay. */
export function useSave(refresh: () => Promise<unknown>, onSaved: () => void) {
  const api = useApi();
  const [state, setState] = useState<SavePhase>({ phase: 'idle' });
  const send = useCallback(
    async (attempt: Attempt) => {
      setState({ phase: 'pending' });
      let reply: ApiClientResult<unknown>;
      try {
        reply = await writeSettings(api, attempt.data, attempt.patch, attempt.requestId);
      } catch {
        reply = { ok: false, error: { kind: 'transport' } };
      }
      if (!reply.ok) {
        setState({ phase: 'failed', failure: reply.error, attempt });
        return;
      }
      setState({ phase: 'saved' });
      onSaved();
      await refresh();
    },
    [api, onSaved, refresh],
  );
  return {
    state,
    save: (data: SettingsData, patch: Patch) => void send({ requestId: crypto.randomUUID(), data, patch }),
    replay: () => {
      if (state.phase === 'failed') void send(state.attempt);
    },
    /** An edit after a failure or a save starts a new intent. */
    reset: () => setState({ phase: 'idle' }),
  };
}
