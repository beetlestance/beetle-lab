import { useState } from 'react';
import type {
  ApiClient,
  ApiClientFailure,
  ApiClientResult,
  Folder,
  Organization,
  Workspace,
} from '@beetle/contracts/api';
import { useApi } from '../../app/api.js';

export type Target =
  | { kind: 'organization'; entity: Organization }
  | { kind: 'workspace'; entity: Workspace }
  | { kind: 'folder'; entity: Folder };

export function sendDeletion(api: ApiClient, target: Target, requestId: string): Promise<ApiClientResult<unknown>> {
  const body = { scope: target.entity.scope, expectedVersion: target.entity.version, requestId };
  switch (target.kind) {
    case 'organization':
      return api.deleteOrganization({
        params: { organizationId: target.entity.id },
        body: { ...body, scope: target.entity.scope },
      });
    case 'workspace':
      return api.deleteWorkspace({
        params: { organizationId: target.entity.scope.organizationId, workspaceId: target.entity.id },
        body: { ...body, scope: target.entity.scope },
      });
    case 'folder':
      return api.deleteFolder({
        params: { organizationId: target.entity.scope.organizationId, id: target.entity.id },
        body: { ...body, scope: target.entity.scope },
      });
  }
}

export type DeletionState =
  | { phase: 'confirm' }
  | { phase: 'pending' }
  | { phase: 'failed'; failure: ApiClientFailure; requestId: string }
  | { phase: 'done' };

/** One request ID per confirmation; only an unknown outcome is replayed, with the identical body. */
export function useDeletion(target: Target, onDone: () => void) {
  const api = useApi();
  const [state, setState] = useState<DeletionState>({ phase: 'confirm' });
  async function send(requestId: string) {
    setState({ phase: 'pending' });
    let reply: ApiClientResult<unknown>;
    try {
      reply = await sendDeletion(api, target, requestId);
    } catch {
      reply = { ok: false, error: { kind: 'transport' } };
    }
    if (!reply.ok) {
      setState({ phase: 'failed', failure: reply.error, requestId });
      return;
    }
    setState({ phase: 'done' });
    onDone();
  }
  return {
    state,
    confirm: () => void send(crypto.randomUUID()),
    replay: () => {
      if (state.phase === 'failed') void send(state.requestId);
    },
  };
}
