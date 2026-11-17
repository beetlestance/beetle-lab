import { AssertionError } from 'node:assert';

export const nativeFailureCodes = new Set([
  'assertion',
  'compose',
  'public_timeout',
  'public_api',
  'readiness',
  'internal',
  'cleanup',
]);
export const nativeFailureFiles = new Set(['smoke', 'fixture', 'public', 'public-api', 'evidence']);
/** Only a whitelisted source name and numeric location may leave private stacks. */
function site(error: Error) {
  const match =
    /native-application\/(?:compose\/)?(smoke|fixture|public|public-api|evidence)\.(?:ts|js):(\d{1,4}):(\d{1,4})\b/.exec(
      error.stack ?? '',
    );
  return match ? { file: match[1]!, line: Number(match[2]), column: Number(match[3]) } : null;
}
function code(error: Error): string {
  if (error instanceof AssertionError) return 'assertion';
  if (error.message.startsWith('Compose ')) return 'compose';
  if (error.message.startsWith('Public API failure: timeout/')) return 'public_timeout';
  if (error.message.startsWith('Public API failure: ')) return 'public_api';
  if (error.message === 'Public readiness deadline') return 'readiness';
  return 'internal';
}
function publicStatus(error: Error): number | null {
  const match = /^(?:Public API failure: [a-z_]+\/|Unexpected authenticated readiness refusal: )([1-5][0-9]{2})\//.exec(
    error.message,
  );
  return match ? Number(match[1]) : null;
}
export function nativeFailure(error: unknown) {
  if (!(error instanceof Error)) return { code: 'internal', site: null };
  const status = publicStatus(error);
  return { code: code(error), site: site(error), ...(status === null ? {} : { publicStatus: status }) };
}
