import { QueryClient } from '@tanstack/react-query';

const root = ['namespace'] as const;
export const queryKeys = {
  settings: ['settings'] as const,
  installationSettings: ['settings', 'installation'] as const,
  organizationSettings: (id: string) => ['settings', 'organization', id.toLowerCase()] as const,
  workspaceSettings: (org: string, id: string) => ['settings', 'organization', org.toLowerCase(), 'workspace', id.toLowerCase()] as const,
  organizations: [...root, 'organizations'] as const,
  organization: (id: string) => [...root, 'organization', id.toLowerCase()] as const,
  workspaces: (id: string) => [...root, 'organization', id.toLowerCase(), 'workspaces'] as const,
  workspace: (org: string, id: string) => [...root, 'organization', org.toLowerCase(), 'workspace', id.toLowerCase()] as const,
  folders: (org: string, id: string) => [...root, 'organization', org.toLowerCase(), 'workspace', id.toLowerCase(), 'folders'] as const,
};

export function createQueryClient() {
  return new QueryClient({ defaultOptions: {
    queries: { retry: false, gcTime: 60_000, staleTime: 0, refetchOnWindowFocus: false },
    mutations: { retry: false },
  } });
}
