import { useEffect } from 'react';
import type { ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { Workspace } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { AuthoringState } from '../suites/AuthoringState.js';

/** Direct script links resolve real namespace names; retirement cancels only inactive reads. */
export function ScriptNamespace({
  organizationId,
  workspaceId,
  children,
}: {
  organizationId: string;
  workspaceId: string;
  children: (workspace: Workspace) => ReactNode;
}) {
  const api = useApi();
  const client = useQueryClient();
  const root = queryKeys.workspace(organizationId, workspaceId);
  const organization = useQuery({
    queryKey: queryKeys.organization(organizationId),
    queryFn: ({ signal }) => readResult(api.getOrganization({ params: { organizationId }, signal })),
  });
  const workspace = useQuery({
    queryKey: root,
    enabled: organization.isSuccess,
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params: { organizationId, workspaceId }, signal })),
  });
  useEffect(
    () => () => {
      for (const queryKey of [root, queryKeys.organization(organizationId)]) {
        void client.cancelQueries({ queryKey, type: 'inactive' });
        client.removeQueries({ queryKey, type: 'inactive' });
      }
    },
    [client, organizationId, workspaceId],
  );
  return (
    <AuthoringState query={organization} retainedLabel="Your script and export controls are kept.">
      {() => (
        <AuthoringState query={workspace} retainedLabel="Your script and export controls are kept.">
          {children}
        </AuthoringState>
      )}
    </AuthoringState>
  );
}
