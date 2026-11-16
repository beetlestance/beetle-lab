import {nativeFailure, nativeFailureCodes, nativeFailureFiles} from '../../native-application/compose/failure.js';
const files = new Set([...nativeFailureFiles, 'active', 'observations', 'readiness', 'ownership', 'cleanup', 'run', 'configuration', 'execution']);
export function lifecycleFailure(error: unknown) {
  const known = nativeFailure(error);
  if (!(error instanceof Error)) return known;
  const match = /resources\/lifecycle\/(active|observations|readiness|ownership|cleanup|run|configuration|execution)\.(?:ts|js):(\d{1,4}):(\d{1,4})\b/.exec(error.stack ?? '');
  return {...known, site: match ? {file: match[1]!, line: Number(match[2]), column: Number(match[3])} : known.site};
}
function row(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' ? input as Record<string, unknown> : {};
}
function coordinate(input: unknown): number | null {
  return typeof input === 'number' && Number.isInteger(input) && input > 0 && input <= 9999 ? input : null;
}
function publicSite(input: unknown) {
  const raw = row(input); const file = typeof raw.file === 'string' && files.has(raw.file) ? raw.file : null;
  const line = coordinate(raw.line); const column = coordinate(raw.column);
  return file && line && column ? {file, line, column} : null;
}
/** Revalidate the public carrier even when its JSON input is malformed or forged. */
export function publicDiagnosis(input: unknown) {
  const value = row(input);
  const code = typeof value.code === 'string' && nativeFailureCodes.has(value.code) ? value.code : 'internal';
  return {code, site: publicSite(value.site)};
}
