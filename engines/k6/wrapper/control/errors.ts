export type JournalErrorCode = 'invalid_options' | 'untrusted_directory' | 'unsafe_file' |
  'already_exists' | 'invalid_event' | 'scope_mismatch' | 'frame_limit' | 'quota_limit' |
  'record_limit' | 'busy' | 'closed' | 'poisoned' | 'io_failure' | 'cancelled' |
  'deadline' | 'invalid_cursor' | 'corruption';

/** Fixed messages deliberately exclude filesystem paths and caller payloads. */
export class JournalError extends Error {
  constructor(readonly code: JournalErrorCode) { super(code); this.name = 'JournalError'; }
}

export function safeError(error: unknown): JournalError {
  return error instanceof JournalError ? error : new JournalError('io_failure');
}
