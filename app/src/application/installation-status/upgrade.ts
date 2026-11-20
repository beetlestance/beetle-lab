import { encodeJson } from '@beetle/contracts';
import { validateApi } from '@beetle/contracts/api';
import type { UpgradeStatus } from '@beetle/contracts/api';
import type { AgentStatusView, InstallationStatusReader } from '../../ports/installation-status.js';
import { requireRule } from '../../domain/namespaces/index.js';
import { AGENT_STALE_AFTER_MS } from './freshness.js';

/** What the composition knows about this backend and the host's upgrade fence. */
export interface UpgradeFacts {
  /** The bundle's release name, or null when the build carries none. */
  readonly release: string | null;
  readonly metadataSchema: number;
  /** The upgrade operation UUID while the fence is set, otherwise null. */
  readonly fence: string | null;
}
export interface UpgradeStatusInput {
  readonly reader: InstallationStatusReader;
  readonly agent: AgentStatusView | null;
  readonly facts: UpgradeFacts;
  readonly nowMs: number;
}

function freeBytes(agent: AgentStatusView | null, now: number): UpgradeStatus['backup']['freeBytes'] {
  const last = agent?.last;
  if (!last || last.kind !== 'ready') return { status: 'unknown', value: null };
  const age = now - last.facts.observedAtMs;
  if (age < 0 || age > AGENT_STALE_AFTER_MS) return { status: 'unknown', value: null };
  return { status: 'measured', value: last.facts.backendDisk.availableBytes };
}

/**
 * Read-only upgrade view for Settings › Installation › Upgrade. It reports what this
 * backend can know: its release, the fence the host set, and the work that keeps it from
 * draining. Host-side phases and steps stay with `setup upgrade status`.
 */
export async function getUpgradeStatus(input: UpgradeStatusInput): Promise<UpgradeStatus> {
  const [work, usage] = await Promise.all([input.reader.unfinishedWork(), input.reader.poolUsage()]);
  const value = {
    scope: { kind: 'installation' },
    generatedAt: new Date(input.nowMs).toISOString(),
    release: { name: input.facts.release, metadataSchema: input.facts.metadataSchema },
    path: 'next_release_only',
    phase: input.facts.fence ? 'fenced' : 'open',
    operationId: input.facts.fence,
    unfinished: work,
    backup: { atLeastBytes: usage.storage.chargedBytes, freeBytes: freeBytes(input.agent, input.nowMs) },
  };
  const result = validateApi('UpgradeStatus', JSON.parse(encodeJson(value, 4096)) as unknown);
  requireRule(result.ok);
  return result.value;
}
