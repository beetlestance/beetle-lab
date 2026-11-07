import type { AdmissionCommand, Candidate } from '../admission/index.js';
import { estimateStaging, zeroResources } from '../admission/index.js';

/** Project bounded scheduling metadata without retaining the engine configuration. */
export function projectCandidate(request: Extract<AdmissionCommand, { kind: 'offer' }>, legacy: boolean, lastClock: number): Candidate | null {
  const offer = request.offer;
  let staging;
  try { staging = estimateStaging(offer); } catch { return null; }
  const resources = { ...zeroResources(), cpuMillis: offer.budget.cpuMillis, memoryBytes: offer.budget.memoryBytes,
    pids: offer.budget.pids, outputBytes: offer.budget.outputBytes, stagingBytes: staging.totalBytes };
  return { staging, attemptId: offer.attemptId, organizationId: offer.organizationId,
    workspaceId: offer.workspaceId, generation: 1, resources, budget: offer.budget, mode: offer.executionPolicy.mode,
    preferIdle: offer.executionPolicy.preferIdle, requiredCapabilities: offer.requiredCapabilities,
    engine: offer.engine, validation: request.validation, queuedAt: legacy || request.now < lastClock ? null : request.now, order: 0 };
}
