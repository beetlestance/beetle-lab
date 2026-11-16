export type ClientCode = 'invalid_input' | 'io' | 'unavailable' | 'request_failed' | 'outcome_unknown' | 'interrupted';
export class ClientError extends Error {
  constructor(readonly code: ClientCode, readonly exit: number, readonly requestId?: string) {super(code);}
}

export function ensureActive(signal: AbortSignal): void {if (signal.aborted) throw new ClientError('interrupted', 5);}
