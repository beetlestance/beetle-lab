import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ApiClient, InputTransferClient, Workspace } from '@beetle/contracts/api';
import { queryKeys } from '../../app/queries.js';
import { UploadWorkflow } from './workflow.js';
import type { UploadState } from './workflow.js';

/** One workflow owner per mounted draft; unmount disposes it (departure semantics). */
export function useUploadOwner(api: ApiClient, transfers: InputTransferClient, workspace: Workspace) {
  const cache = useQueryClient();
  const [initialWorkspace] = useState(workspace);
  const [state, setState] = useState<UploadState>({ phase: 'idle', busy: false, retained: false, message: '' });
  const workflow = useRef<UploadWorkflow | null>(null);
  useEffect(() => {
    const owner = new UploadWorkflow({
      api,
      transfers,
      workspace: initialWorkspace,
      changed: setState,
      invalidate: () => {
        void cache.invalidateQueries({
          queryKey: queryKeys.inputs(initialWorkspace.scope.organizationId, initialWorkspace.id),
        });
      },
    });
    workflow.current = owner;
    return () => {
      owner.dispose();
      workflow.current = null;
    };
  }, [api, transfers, initialWorkspace, cache]);
  return { state, workflow };
}
