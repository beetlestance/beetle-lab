import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { useWorkspaceSnapshot } from '../../app/overview.js';
import { useSessionAccess } from '../../app/session.js';
import { validId } from '../../app/routes.js';
import { AuthoringState } from './AuthoringState.js';
import { FolderView } from './FolderView.js';
import { SuiteDetail } from './SuiteDetail.js';
import { SuitesLoading } from './SuiteStates.js';
import { SuiteIndex } from './SuiteIndex.js';
import './suites.css';
import './listing.css';

/**
 * Suites route: the folder list (Suites), one folder (`?folder=<id>`, Suites / Folder)
 * or one suite (Suite / Overview, Edit and Revisions tabs, Start run dialog).
 */
export function Suites({
  organizationId,
  workspaceId,
  suiteId,
}: {
  organizationId: string;
  workspaceId: string;
  suiteId?: string;
}) {
  const api = useApi();
  const client = useQueryClient();
  const [search] = useSearchParams();
  const params = { organizationId, workspaceId };
  const key = queryKeys.workspace(organizationId, workspaceId);
  const organization = useQuery({
    queryKey: queryKeys.organization(organizationId),
    queryFn: ({ signal }) => readResult(api.getOrganization({ params: { organizationId }, signal })),
  });
  const workspace = useQuery({
    queryKey: key,
    enabled: organization.data !== undefined,
    queryFn: ({ signal }) => readResult(api.getWorkspace({ params, signal })),
  });
  const { readOnly } = useSessionAccess();
  useWorkspaceSnapshot(organizationId, workspaceId, !readOnly && workspace.isSuccess && organization.isSuccess);
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: key });
      client.removeQueries({ queryKey: key });
      void client.cancelQueries({ queryKey: queryKeys.organization(organizationId) });
      client.removeQueries({ queryKey: queryKeys.organization(organizationId) });
    },
    [client, organizationId, workspaceId],
  );
  const folders = search.getAll('folder');
  const folderId = folders.length === 1 && validId(folders[0]) ? folders[0] : undefined;
  return (
    <AuthoringState query={organization} loading={<SuitesLoading />}>
      {() => (
        <AuthoringState query={workspace} loading={<SuitesLoading />}>
          {(data) =>
            suiteId ? (
              <SuiteDetail key={`${organizationId}/${workspaceId}/${suiteId}`} workspace={data} suiteId={suiteId} />
            ) : folderId ? (
              <FolderView key={`${organizationId}/${workspaceId}/${folderId}`} workspace={data} folderId={folderId} />
            ) : (
              <SuiteIndex key={`${organizationId}/${workspaceId}`} workspace={data} />
            )
          }
        </AuthoringState>
      )}
    </AuthoringState>
  );
}
