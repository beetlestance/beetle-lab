import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { InstallationStatus } from '@beetle/contracts/api';
import { readResult, useApi } from '../../app/api.js';
import { queryKeys } from '../../app/queries.js';

/** Installation status (035), one read per mount; unmount cancels and removes it. No polling. */
export function useInstallationStatus() {
  const api = useApi();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.installationStatus,
    queryFn: ({ signal }) => readResult(api.getInstallationStatus({ signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: queryKeys.installationStatus, exact: true });
      client.removeQueries({ queryKey: queryKeys.installationStatus, exact: true });
    },
    [client],
  );
  return query;
}

/** Engine catalogue (`listEngines`), one read per mount; unmount cancels and removes it. */
export function useEngineCatalogue() {
  const api = useApi();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.engineCatalogue,
    queryFn: ({ signal }) => readResult(api.listEngines({ signal })),
  });
  useEffect(
    () => () => {
      void client.cancelQueries({ queryKey: queryKeys.engineCatalogue, exact: true });
      client.removeQueries({ queryKey: queryKeys.engineCatalogue, exact: true });
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

/** Notice copy for Engines / Unavailable; "for 4 min" only when the last report time is known. */
export function unavailableText(status: InstallationStatus): string {
  const after = "New runs and exports can't start until it reports again.";
  switch (status.agent.state) {
    case 'stale': {
      const since = minutesSince(status.agent.lastSeenAt, status.generatedAt);
      return since === undefined
        ? `Beetle hasn't heard from the runner agent recently. ${after}`
        : `Beetle hasn't heard from the runner agent for ${since} min. ${after}`;
    }
    case 'unreachable':
      return `Beetle can't reach the runner agent. ${after}`;
    case 'unavailable':
      return `The runner agent reports that it can't run engines. ${after}`;
    case 'disabled':
      return 'Running engines is turned off on this installation. New runs and exports wait until it is turned on.';
    default:
      return agentText[status.agent.state].detail;
  }
}

function minutesSince(from: string | null, to: string): number | undefined {
  if (!from) return undefined;
  const elapsed = new Date(to).getTime() - new Date(from).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 0) return undefined;
  return Math.max(1, Math.round(elapsed / 60_000));
}
