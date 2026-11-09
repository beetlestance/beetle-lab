import { validatePrimitive } from '@beetle/contracts';

export type InstallationStateCode = 'owned' | 'recovery_required' | 'invalid_input' | 'closed' | 'unavailable';
export class InstallationStateError extends Error {
  constructor(readonly code: InstallationStateCode) { super(`Installation state ${code}`); }
}
export function authority(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length !== 36 || value !== value.toLowerCase()
    || !validatePrimitive('uuid', value).ok) throw new InstallationStateError('invalid_input');
}
export type State = { phase: 'initializing'; operationId: string; authority: null; pending: null }
  | { phase: 'ready'; operationId: null; authority: string; pending: null }
  | { phase: 'restoring'; operationId: string; authority: string; pending: string };

function stateShape(value: Record<string, unknown>): Readonly<State> {
  switch (value.phase) {
    case 'initializing':
      authority(value.operationId);
      if (value.authority !== null || value.pending !== null) throw new InstallationStateError('recovery_required');
      return Object.freeze({ phase: 'initializing', operationId: value.operationId, authority: null, pending: null });
    case 'ready':
      authority(value.authority);
      if (value.operationId !== null || value.pending !== null) throw new InstallationStateError('recovery_required');
      return Object.freeze({ phase: 'ready', operationId: null, authority: value.authority, pending: null });
    case 'restoring':
      authority(value.authority); authority(value.operationId); authority(value.pending);
      if (value.pending === value.authority) throw new InstallationStateError('recovery_required');
      return Object.freeze({ phase: 'restoring', operationId: value.operationId, authority: value.authority, pending: value.pending });
    default: throw new InstallationStateError('recovery_required');
  }
}
export function capturedState(value: Record<string, unknown> | undefined): Readonly<State> {
  if (!value) throw new InstallationStateError('recovery_required');
  try { return stateShape(value); } catch { throw new InstallationStateError('recovery_required'); }
}
