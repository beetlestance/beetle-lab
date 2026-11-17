import type { Capabilities, ClientFailure } from '@beetle/contracts';
import type { AgentFacts, AgentSampleOutcome, AgentStatusRecorder } from '../../../ports/installation-status.js';

/** No HTTP reply at all is unreachable; any reply that refused or failed checks is unavailable. */
export function failureKind(error: ClientFailure): 'unreachable' | 'unavailable' {
  return error.kind === 'transport' || error.kind === 'timeout' ? 'unreachable' : 'unavailable';
}
/** Facts come only from a frame that already passed installation, pin and provenance checks. */
export function agentFacts(
  frame: Capabilities,
  disk: { total: number; available: number },
  observedAtMs: number,
  pins: readonly string[],
): AgentFacts {
  const daemon = frame.observation.daemonCapacity;
  return {
    observedAtMs,
    daemon: daemon ? { cpuMillis: daemon.cpuMillis, memoryBytes: daemon.memoryBytes } : null,
    stagingFreeBytes: frame.observation.freeStagingDiskBytes,
    backendDisk: { totalBytes: disk.total, availableBytes: disk.available },
    imageDigests: frame.engines.map((engine) => engine.imageDigest).filter((digest) => pins.includes(digest)),
  };
}
/** Informational sink: recorder faults or clock faults never change capacity outcomes. */
export class StatusReport {
  constructor(
    private readonly recorder: AgentStatusRecorder | undefined,
    private readonly wall: () => number,
  ) {}
  ready(facts: AgentFacts): void {
    this.emit((checkedAtMs) => ({ kind: 'ready', checkedAtMs, facts }));
  }
  failed(kind: 'unreachable' | 'unavailable'): void {
    this.emit((checkedAtMs) => ({ kind, checkedAtMs }));
  }
  private emit(build: (checkedAtMs: number) => AgentSampleOutcome): void {
    if (this.recorder === undefined) return;
    try {
      const now = this.wall();
      if (Number.isSafeInteger(now) && now >= 0) this.recorder.record(build(now));
    } catch {
      // Status is advisory; capacity custody must not depend on it.
    }
  }
}
