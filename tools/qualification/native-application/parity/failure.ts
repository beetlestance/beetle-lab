import { nativeFailure, nativeFailureCodes, nativeFailureFiles } from '../compose/failure.js';
const files = ['parity-run', 'parity-result', 'parity-counters', 'parity-config', 'parity-target'];
/** No raw message, stack, assertion values or submitted data may leave the runner. */
export function parityFailure(error: unknown) {
  const known = nativeFailure(error);
  if (!(error instanceof Error)) return known;
  const match = /native-application\/parity\/(run|result|counters|config|target)\.(?:ts|js):(\d{1,4}):(\d{1,4})\b/.exec(
    error.stack ?? '',
  );
  return {
    ...known,
    site: match ? { file: 'parity-' + match[1], line: Number(match[2]), column: Number(match[3]) } : known.site,
  };
}
function object(input: unknown): Record<string, unknown> {
  return input && typeof input === 'object' && !Array.isArray(input) ? (input as Record<string, unknown>) : {};
}
function coordinate(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 && value <= 9999;
}
function location(input: unknown) {
  const site = object(input);
  const allowed = [...files, ...nativeFailureFiles];
  return typeof site.file === 'string' &&
    allowed.includes(site.file) &&
    coordinate(site.line) &&
    coordinate(site.column)
    ? { file: site.file, line: site.line, column: site.column }
    : null;
}
function publicStatus(input: unknown) {
  return typeof input === 'number' && Number.isInteger(input) && input >= 100 && input <= 599 ? input : null;
}
/** Validate again at the upload boundary; private evidence is not trusted output. */
export function publicParityFailure(input: unknown) {
  const row = object(input);
  return {
    code: typeof row.code === 'string' && nativeFailureCodes.has(row.code) ? row.code : 'internal',
    site: location(row.site),
    publicStatus: publicStatus(row.publicStatus),
  };
}
