import { useQuery } from '@tanstack/react-query';
import type { Workspace, Suite, Run } from '@beetle/contracts/api';
import { useApi, readResult } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';
import { routes } from '../../app/routes.js';
import type { CommandItem } from './model.js';
import { runStatus, shortId } from '../workspace-overview/format.js';
export interface CommandGroup {
  name: string;
  active: boolean;
  loading: boolean;
  error: boolean;
  more: boolean;
  items: CommandItem[];
  refresh: () => Promise<unknown>;
}
interface PageQuery<T> {
  data: { items: readonly T[]; nextCursor: string | null } | undefined;
  isFetching: boolean;
  isError: boolean;
  refetch(): Promise<unknown>;
}
function group<T>(name: string, query: PageQuery<T>, map: (item: T) => CommandItem, active = true): CommandGroup {
  const data = active && !query.isError ? query.data : undefined;
  return {
    name,
    active,
    loading: active && query.isFetching,
    error: active && query.isError,
    more: !!data?.nextCursor,
    items: data?.items.map(map) ?? [],
    refresh: () => query.refetch(),
  };
}
export function useCommandItems(organizationId: string, workspaceId?: string): CommandGroup[] {
  const api = useApi();
  const org = organizationId;
  const workspace = workspaceId ?? '';
  const workspaces = useQuery({
    queryKey: queryKeys.workspacesPage(org),
    refetchOnMount: false,
    retryOnMount: false,
    queryFn: ({ signal }) =>
      readResult(api.listWorkspaces({ params: { organizationId: org }, query: { limit: 100 }, signal })),
  });
  const suites = useQuery({
    queryKey: queryKeys.suitesPage(org, workspace),
    enabled: !!workspaceId,
    refetchOnMount: false,
    retryOnMount: false,
    queryFn: ({ signal }) =>
      readResult(
        api.listSuites({ params: { organizationId: org, workspaceId: workspace }, query: { limit: 100 }, signal }),
      ),
  });
  const runs = useQuery({
    queryKey: queryKeys.runsPage(org, workspace),
    enabled: !!workspaceId,
    refetchOnMount: false,
    retryOnMount: false,
    queryFn: ({ signal }) =>
      readResult(
        api.listRuns({ params: { organizationId: org, workspaceId: workspace }, query: { limit: 100 }, signal }),
      ),
  });
  return [
    group<Workspace>('workspaces', workspaces, (row) => ({
      id: 'workspace:' + row.id,
      label: row.name,
      description: 'Workspace',
      path: routes.workspace(org, row.id),
    })),
    group<Suite>(
      'suites',
      suites,
      (row) => ({
        id: 'suite:' + row.id,
        label: row.name,
        description: 'Suite',
        path: routes.suite(org, workspace, row.id),
      }),
      !!workspaceId,
    ),
    group<Run>(
      'runs',
      runs,
      (row) => {
        const suiteName = suites.isError ? undefined : suites.data?.items.find((item) => item.id === row.suiteId)?.name;
        return {
          id: 'run:' + row.id,
          label: `Run ${shortId(row.id)}${suiteName ? ', ' + suiteName : ''}`,
          description: runStatus(row.state, row.outcome).label,
          path: routes.run(org, workspace, row.id),
        };
      },
      !!workspaceId,
    ),
  ];
}
