import {nativeFailureCodes, nativeFailureFiles} from './failure.js';
const phases = new Set(['startup', 'compose-up', 'local-session', 'agent-readiness', 'control-reserve', 'ordinary-run', 'offline-export', 'second-up', 'restart', 'cleanup']);
const architectures = new Set(['amd64', 'arm64']);
const roles = ['frontend', 'backend', 'agent', 'installer', 'engine', 'offline'] as const;
function member(value: unknown, allowed: ReadonlySet<string>): string | null {
  return typeof value === 'string' && allowed.has(value) ? value : null;
}
function matching(value: unknown, pattern: RegExp): string | null {
  return typeof value === 'string' && pattern.test(value) ? value : null;
}
function location(input: unknown) {
  if (!input || typeof input !== 'object') return null;
  const value = input as Record<string, unknown>; const file = member(value.file, nativeFailureFiles);
  if (!file || !Number.isInteger(value.line) || !Number.isInteger(value.column)) return null;
  const line = value.line as number; const column = value.column as number;
  return line > 0 && line <= 9999 && column > 0 && column <= 9999 ? {file, line, column} : null;
}
function diagnosis(input: unknown) {
  const value = input && typeof input === 'object' ? input as Record<string, unknown> : {};
  const status=value.publicStatus;
  const http=typeof status==='number'&&Number.isInteger(status)&&status>=100&&status<600?{publicStatus:status}:{};
  return {code: member(value.code, nativeFailureCodes) ?? 'internal', site: location(value.site),...http};
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
    diagnosis: passed ? null : diagnosis(evidence.diagnosis),
  } as const;
}
