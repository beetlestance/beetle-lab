const knownCodes = new Set<unknown>([
  'configuration', 'data_directory', 'listener', 'invalid_input', 'conflict',
  'busy', 'startup', 'cleanup',
  'not_found', 'queue_full', 'closed', 'unavailable', 'owned', 'schema_newer',
  'stale_generation', 'quota_exceeded', 'cursor_expired', 'expired_key', 'recovery_required',
  'EACCES', 'EPERM', 'ENOENT', 'ENOSPC', 'EIO', 'EBUSY', 'EADDRINUSE',
  'ECONNREFUSED', 'ETIMEDOUT', 'EROFS', 'EMFILE', 'ENFILE',
]);
/** Error text and stacks can contain secrets; expose only bounded fixed codes. */
export function failureCodes(error: unknown): readonly string[] {
  const codes: string[] = []; const seen = new Set<Error>();
  try {
    while (error instanceof Error && codes.length < 4 && !seen.has(error)) {
      seen.add(error);
      const code = ownDiagnosticCode(error);
      codes.push(knownCodes.has(code) ? code as string : 'unknown');
      error = Object.getOwnPropertyDescriptor(error, 'cause')?.value;
    }
  } catch { /* Untrusted descriptors must not interrupt shutdown. */ }
  return codes.length ? codes : ['unknown'];
}
export function reportFailure(event: 'startup_failed' | 'shutdown_failed' | 'storage_failed' | 'shutdown_deadline', error: unknown): void {
  try {
    process.stderr.write(`${JSON.stringify({component: 'agent', event, codes: failureCodes(error)})}\n`);
  } catch { /* Diagnostics must not prevent cleanup or failure exit. */ }
}

function ownDiagnosticCode(error: Error): unknown {
  return Object.getOwnPropertyDescriptor(error, 'code')?.value
    ?? Object.getOwnPropertyDescriptor(error, 'reason')?.value;
}
