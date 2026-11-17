import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstallationStatus } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';

/** Installation status (035): agent reachability, host and disk facts, engine images, pool use. */
export const installationStatusKey = ['installation', 'status'] as const;

/** One read per mount; unmount cancels and removes it. No polling. */
export function useInstallationStatus() {
  const api = useApi();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: installationStatusKey,
    queryFn: ({ signal }) => readResult(api.getInstallationStatus({ signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: installationStatusKey, exact: true });
      client.removeQueries({ queryKey: installationStatusKey, exact: true });
    },
    [client],
  );
  return query;
}

export type AgentState = InstallationStatus['agent']['state'];

/** States that make engines unusable now (Penpot "Engines / Unavailable"). */
export function agentUnavailable(state: AgentState): boolean {
  return state === 'unreachable' || state === 'unavailable' || state === 'stale';
}

export const agentText: Record<AgentState, { label: string; detail: string }> = {
  ready: { label: 'Ready', detail: 'The agent is reachable and accepting runs.' },
  stale: { label: 'Not reporting', detail: 'The agent has not reported recently. Runs may wait or fail to start.' },
  unavailable: { label: 'Unavailable', detail: 'The agent reports that it cannot run engines right now.' },
  unreachable: { label: 'Unreachable', detail: 'The backend cannot reach the agent. Runs cannot start.' },
  unknown: { label: 'Unknown', detail: 'The agent state has not been checked yet.' },
  disabled: { label: 'Disabled', detail: 'Running engines is turned off on this installation.' },
};

export function formatTime(value: string | null): string | undefined {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return undefined;
  return date.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}
