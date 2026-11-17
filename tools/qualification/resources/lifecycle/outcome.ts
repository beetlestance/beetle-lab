import { publicDiagnosis } from './diagnosis.js';
const kinds = ['backend', 'agent', 'cancel'] as const;
const phases = ['startup', 'backend', 'agent', 'cancel', 'offline-custody'];
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'];
function row(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}
function scalar(input: unknown, maximum = Number.MAX_SAFE_INTEGER): number | null {
  return typeof input === 'number' && Number.isSafeInteger(input) && input >= 0 && input <= maximum ? input : null;
}
function matching(input: unknown, pattern: RegExp): string | null {
  return typeof input === 'string' && pattern.test(input) ? input : null;
}
function sampled(input: unknown): boolean {
  const value = row(input);
  const samples = scalar(value.samples) ?? 0;
  return (
    samples > 0 &&
    value.source === 'docker-stats' &&
    value.scope === 'container' &&
    value.outputBytes === null &&
    scalar(value.cpuMillis) !== null &&
    scalar(value.peakMemoryBytes, 536870912) !== null &&
    scalar(value.peakPids, 128) !== null
  );
}
function expectedWork(value: ReturnType<typeof caseValue>): boolean {
  const count = value.workRequests ?? -1;
  return value.kind === 'cancel' ? count >= 8 && count < 40 : count === 40;
}
function caseValue(input: Record<string, unknown>) {
  const summaries = Array.isArray(input.summaries) && input.summaries.length <= 100 ? input.summaries : [];
  const final = row(summaries.at(-1));
  const recovery = row(input.recovery);
  return {
    recovery: {
      elapsedMs: scalar(recovery.elapsedMs, 600000),
      progressAtAcknowledgedKill: scalar(recovery.progressAtAcknowledgedKill, 40),
      status: scalar(recovery.status, 599),
      ready: recovery.ready === true,
      workAtReadiness: scalar(recovery.workAtReadiness, 40),
    },
    kind: kinds.find((kind) => kind === input.kind) ?? null,
    sameOriginal: input.sameOriginal === true,
    workRequests: scalar(input.workRequests, 40),
    resourcesReported: input.resourceStatus === 'passed' && summaries.some(sampled),
    resourceSummaries: summaries.length,
    finalReason: member(final.reason, ['unavailable', 'unsupported', 'invalid', 'counter_reset', 'restarted', 'clock']),
    missedSamples: scalar(final.missedSamples),
    hasCpu: scalar(final.cpuMillis) !== null,
    hasMemory: scalar(final.peakMemoryBytes) !== null,
    hasPids: scalar(final.peakPids) !== null,
    finalSamples: scalar(final.samples),
    restarted: final.reason === 'restarted',
  };
}
function complete(
  cases: ReturnType<typeof caseValue>[],
  custody: Record<string, unknown>[],
  expected: readonly string[],
) {
  return (
    cases.length === expected.length &&
    expected.every((kind) => cases.filter((value) => value.kind === kind).length === 1) &&
    cases.every((value) => value.sameOriginal && value.resourcesReported && expectedWork(value)) &&
    custody.length === expected.length &&
    custody.every(
      (value) => value.executionReleased === true && (scalar(value.originalAllocationChargedBytes) ?? 0) > 0,
    )
  );
}
function member(value: unknown, allowed: readonly string[]): string | null {
  return typeof value === 'string' && allowed.includes(value) ? value : null;
}
function identity(value: Record<string, unknown>) {
  const mode = member(value.mode, ['crashes', 'cancel']);
  const architecture = member(value.architecture, ['amd64', 'arm64']);
  const phase = member(value.phase, phases);
  const revision = matching(value.revision, /^[a-f0-9]{40}$/);
  const images = row(value.imageIds);
  const imageIds = Object.fromEntries(roles.map((role) => [role, matching(images[role], /^sha256:[a-f0-9]{64}$/)]));
  const valid = value.format === 'beetle-active-recovery' && value.version === 1 && mode && revision && architecture;
  return { mode, architecture, phase, revision, imageIds, valid: Boolean(valid) };
}
function accepted(
  value: Record<string, unknown>,
  captured: ReturnType<typeof identity>,
  cases: ReturnType<typeof caseValue>[],
  custody: Record<string, unknown>[],
) {
  const expected = captured.mode === 'crashes' ? ['backend', 'agent'] : ['cancel'];
  return (
    captured.valid &&
    value.status === 'passed' &&
    value.cleanupVerified === true &&
    captured.phase === 'offline-custody' &&
    Object.values(captured.imageIds).every(Boolean) &&
    complete(cases, custody, expected)
  );
}
/** Fixed public projection: no raw exception, path, DB snapshot, token or arbitrary field. */
export function publicLifecycleOutcome(input: unknown) {
  const value = row(input);
  const captured = identity(value);
  const original = Array.isArray(value.results) && value.results.length <= 6 ? value.results.map(row) : [];
  const cases = original.filter((item) => kinds.some((kind) => kind === item.kind)).map(caseValue);
  const custody = original.filter((item) => item.kind === 'custody');
  return {
    format: 'beetle-lifecycle-qualification',
    version: 1,
    status: accepted(value, captured, cases, custody) ? 'passed' : 'failed',
    mode: captured.mode,
    phase: captured.phase,
    sourceRevision: captured.revision,
    architecture: captured.architecture,
    cleanupVerified: value.cleanupVerified === true,
    diagnosis: value.status === 'passed' ? null : publicDiagnosis(value.diagnosis),
    imageIds: captured.imageIds,
    cases,
    originalAllocations: custody.map((item) => scalar(item.originalAllocationChargedBytes)),
  };
}
