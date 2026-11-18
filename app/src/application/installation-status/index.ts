import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { InstallationStatus, RunQueueStatus } from '@beetle/contracts/api';
import type {
  AgentFacts,
  AgentStatusView,
  InstallationStatusReader,
  PoolUsageFacts,
} from '../../ports/installation-status.js';
import type { RunKey } from '../../ports/runs.js';
import { requireRule } from '../../domain/namespaces/index.js';
export { AgentStatusBoard } from './board.js';

/** A ready sample older than this (or from the future) is reported stale, never current. */
export const AGENT_STALE_AFTER_MS = 5000;
type Quantity = InstallationStatus['host']['cpuCores'];
type AgentState = InstallationStatus['agent']['state'];
const unknown: Quantity = Object.freeze({ status: 'unknown', value: null });
const notMeasured: Quantity = Object.freeze({ status: 'not_measured', value: null });
const measured = (value: number): Quantity => ({ status: 'measured', value });
const iso = (value: number | undefined): string | null => (value === undefined ? null : new Date(value).toISOString());

function agentState(view: AgentStatusView | null, now: number): { state: AgentState; facts: AgentFacts | null } {
  if (view === null) return { state: 'disabled', facts: null };
  const last = view.last;
  if (last === null) return { state: 'unknown', facts: null };
  if (last.kind !== 'ready') return { state: last.kind, facts: null };
  const age = now - last.facts.observedAtMs;
  if (age < 0 || age > AGENT_STALE_AFTER_MS) return { state: 'stale', facts: null };
  return { state: 'ready', facts: last.facts };
}
function host(facts: AgentFacts | null): InstallationStatus['host'] {
  const daemon = facts?.daemon;
  const absent = facts === null ? unknown : notMeasured;
  return {
    source: 'docker-daemon',
    cpuCores: daemon ? measured(Math.floor(daemon.cpuMillis / 1000)) : absent,
    memoryTotalBytes: daemon ? measured(daemon.memoryBytes) : absent,
    cpuUsedMillis: notMeasured,
    memoryAvailableBytes: notMeasured,
  };
}
function disk(facts: AgentFacts | null, usage: PoolUsageFacts): InstallationStatus['disk'] {
  return {
    backendFreeBytes: facts ? measured(facts.backendDisk.availableBytes) : unknown,
    backendTotalBytes: facts ? measured(facts.backendDisk.totalBytes) : unknown,
    stagingFreeBytes: facts ? measured(facts.stagingFreeBytes) : unknown,
    freeSpaceReserveBytes: usage.storage.reserveBytes,
    storageAllocationBytes: usage.storage.allocationBytes,
    storageChargedBytes: usage.storage.chargedBytes,
  };
}
function checked<T>(name: 'InstallationStatus' | 'RunQueueStatus', value: unknown): T {
  const result = validateApi(name, JSON.parse(encodeJson(value, 65536)) as unknown);
  requireRule(result.ok);
  return result.value as T;
}

export interface InstallationStatusInput {
  readonly reader: InstallationStatusReader;
  /** Null when this backend has no agent runtime configured. */
  readonly agent: AgentStatusView | null;
  readonly nowMs: number;
}
/** Combines in-memory agent facts with backend dispatch accounting; never contacts the agent. */
export async function getInstallationStatus(input: InstallationStatusInput): Promise<InstallationStatus> {
  const usage = await input.reader.poolUsage();
  const { state, facts } = agentState(input.agent, input.nowMs);
  const engines = (input.agent?.engines ?? []).map((pin) => ({
    profileId: pin.profileId,
    imageDigest: pin.imageDigest,
    ...engineVersion(pin, facts),
    image: facts?.imageDigests.includes(pin.imageDigest) ? ('verified_at_agent_start' as const) : ('unknown' as const),
  }));
  return checked('InstallationStatus', {
    scope: { kind: 'installation' },
    generatedAt: new Date(input.nowMs).toISOString(),
    agent: {
      state,
      lastSeenAt: iso(input.agent?.lastFacts?.observedAtMs),
      checkedAt: iso(input.agent?.last?.checkedAtMs),
    },
    host: host(facts),
    disk: disk(facts, usage),
    engines,
    pool: usage.pool,
  });
}
/** Scoped queue view: names only same-workspace holders; other workspaces are a count. */
export async function getRunQueue(
  key: RunKey,
  reader: InstallationStatusReader,
  nowMs: number,
): Promise<RunQueueStatus> {
  const facts = await reader.runQueue(key);
  requireRule(facts.runId === key.id.toLowerCase(), 'not_found');
  const scope = {
    kind: 'workspace',
    organizationId: key.scope.organizationId.toLowerCase(),
    workspaceId: key.scope.workspaceId.toLowerCase(),
  };
  return checked('RunQueueStatus', { scope, generatedAt: new Date(nowMs).toISOString(), ...facts });
}

/** Advisory metadata only; an image digest alone cannot select another installed profile. */
function engineVersion(
  pin: AgentStatusView['engines'][number],
  facts: AgentFacts | null,
): { engine?: NonNullable<InstallationStatus['engines'][number]['engine']> } {
  if (!facts?.imageDigests.includes(pin.imageDigest)) return {};
  const matching =
    facts.engines?.filter(
      (engine) =>
        engine.profileId === pin.profileId &&
        engine.id === pin.id &&
        engine.configVersion === pin.configVersion &&
        engine.imageDigest === pin.imageDigest,
    ) ?? [];
  if (matching.length !== 1) return {};
  const { id, version, configVersion } = matching[0]!;
  const checked = validateApi('EngineVersion', { id, version, configVersion });
  return checked.ok ? { engine: checked.value } : {};
}
