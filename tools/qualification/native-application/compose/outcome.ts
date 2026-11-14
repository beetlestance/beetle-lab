const phases = new Set(['startup', 'ordinary-run', 'offline-export', 'second-up', 'restart', 'cleanup']);
const architectures = new Set(['amd64', 'arm64']);
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'] as const;
function member(value: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}
function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}
function fixedImages(input: unknown): Readonly<Record<string, string | null>> {
  const source = input && typeof input === 'object' ? input as Readonly<Record<string, unknown>> : {};
  return Object.fromEntries(roles.map(role => {
    const value = source[role];
    return [role, typeof value === 'string' && /^sha256:[a-f0-9]{64}$/.test(value) ? value : null];
  }));
}
/** Public CI artifact/log projection. Never serialize exception text or session data. */
export function nativeOutcome(evidence: Readonly<Record<string, unknown>>) {
  const clean = evidence.cleanupVerified === true;
  const passed = evidence.status === 'passed' && clean;
  return {
    format: 'beetle-native-outcome', version: 1,
    status: passed ? 'passed' : 'failed',
    failure: passed ? null : 'qualification_failed',
    phase: member(evidence.phase, phases) ?? 'unknown',
    revision: matching(evidence.revision, /^[a-f0-9]{40}$/),
    architecture: member(evidence.architecture, architectures),
    cleanupVerified: clean, imageIds: fixedImages(evidence.imageIds),
  } as const;
}
