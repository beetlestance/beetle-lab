import { QueryClient } from '@tanstack/react-query';

const root = ['namespace'] as const;
export const queryKeys = {
  runArtifacts: (org: string, workspace: string, run: string, attempt: string) =>
    [...queryKeys.run(org, workspace, run), 'artifacts', attempt.toLowerCase()] as const,
  runEvents: (org: string, workspace: string, run: string, attempt: string) =>
    [...queryKeys.run(org, workspace, run), 'events', attempt.toLowerCase()] as const,
  runs: (org: string, workspace: string) => [...queryKeys.workspace(org, workspace), 'runs'] as const,
  run: (org: string, workspace: string, id: string) => [...queryKeys.runs(org, workspace), id.toLowerCase()] as const,
  inputs: (org: string, workspace: string) => [...queryKeys.workspace(org, workspace), 'inputs'] as const,
  input: (org: string, workspace: string, id: string) => [...queryKeys.inputs(org, workspace), id.toLowerCase()] as const,
  suites: (org: string, workspace: string) => [...queryKeys.workspace(org, workspace), 'suites'] as const,
  suite: (org: string, workspace: string, id: string) => [...queryKeys.suites(org, workspace), id.toLowerCase()] as const,
  suiteRevisions: (org: string, workspace: string, id: string) => [...queryKeys.suite(org, workspace, id), 'revisions'] as const,
  suiteRevision: (org: string, workspace: string, id: string) => [...queryKeys.workspace(org, workspace), 'revision', id.toLowerCase()] as const,
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
