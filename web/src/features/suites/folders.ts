import { useQuery } from '@tanstack/react-query';
import type { Folder, FolderPage, FolderSummary, Workspace } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';

/** First folder page with summaries; shared cache key with the folder picker. */
export function useFolders(workspace: Workspace) {
  const api = useApi();
  const params = { organizationId: workspace.scope.organizationId, workspaceId: workspace.id };
  return useQuery({
    queryKey: [...queryKeys.folders(params.organizationId, params.workspaceId), ''],
    queryFn: ({ signal }) => readResult(api.listFolders({ params, query: { limit: 100 }, signal })),
  });
}
export function summaryOf(page: FolderPage, folderId: string): FolderSummary | undefined {
  return page.summaries?.find((summary) => summary.folderId.toLowerCase() === folderId.toLowerCase());
}
export function findFolder(page: FolderPage, folderId: string): Folder | undefined {
  return page.items.find((folder) => folder.id.toLowerCase() === folderId.toLowerCase());
}
export function childrenOf(page: FolderPage, folderId: string): Folder[] {
  return page.items.filter((folder) => folder.parentFolderId?.toLowerCase() === folderId.toLowerCase());
}
export const folderLink = (workspace: Workspace, folderId: string) =>
  routes.suitesFolder(workspace.scope.organizationId, workspace.id, folderId);
export function folderName(folder: Folder, workspace: Workspace): string {
  return folder.id.toLowerCase() === workspace.rootFolderId.toLowerCase() ? 'Workspace root' : folder.name;
}
