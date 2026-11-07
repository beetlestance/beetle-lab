import { QueryClient } from '@tanstack/react-query';

const root = ['namespace'] as const;
export const queryKeys = {
  organizations: [...root, 'organizations'] as const,
  organization: (id: string) => [...root, 'organization', id] as const,
  workspaces: (id: string) => [...root, 'organization', id, 'workspaces'] as const,
  workspace: (org: string, id: string) => [...root, 'organization', org, 'workspace', id] as const,
  folders: (org: string, id: string) => [...root, 'organization', org, 'workspace', id, 'folders'] as const,
};

export function createQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: 60_000, staleTime: 0, refetchOnWindowFocus: false },
    mutations: { retry: false },
  } });
}
