import { validatePrimitive } from '@beetle/contracts';
export class RecoveryControlError extends Error {
  constructor(readonly code: 'owned' | 'invalid' | 'recovery_required' | 'closed' | 'cleanup') {super(`Backend recovery ${code}`);}
}
export type RecoveryState = ({readonly phase: 'ready'; readonly operationId: null; readonly manifestDigest: null; readonly attestationDigest: null}
  | {readonly phase: 'restoring'; readonly operationId: string; readonly manifestDigest: string; readonly attestationDigest: null}
  | {readonly phase: 'historical'; readonly operationId: string; readonly manifestDigest: string; readonly attestationDigest: string}) & {readonly purpose: 'installation' | 'history'};
export function identifier(value: unknown): asserts value is string {
  if (typeof value !== 'string' || value.length !== 36 || value !== value.toLowerCase() || !validatePrimitive('uuid', value).ok) throw new RecoveryControlError('invalid');
}
export function digest(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value)) throw new RecoveryControlError('invalid');
}
export function state(value: Record<string, unknown> | undefined): RecoveryState {
  if (!value || !['installation','history'].includes(String(value.purpose))) throw new RecoveryControlError('recovery_required');
  const purpose = value.purpose as 'installation' | 'history';
  if (value.phase === 'ready') return ready(value, purpose);
  if (value.phase !== 'restoring' && value.phase !== 'historical') throw new RecoveryControlError('recovery_required');
  identifier(value.operationId); digest(value.manifestDigest);
  if (value.phase === 'historical') {
    if (purpose !== 'history') throw new RecoveryControlError('recovery_required'); digest(value.attestationDigest);
    return Object.freeze({phase: 'historical', purpose, operationId: value.operationId, manifestDigest: value.manifestDigest, attestationDigest: value.attestationDigest});
  }
  if (value.attestationDigest !== null) throw new RecoveryControlError('recovery_required');
  return Object.freeze({phase: 'restoring', purpose, operationId: value.operationId, manifestDigest: value.manifestDigest, attestationDigest: null});
}
function ready(value: Record<string, unknown>, purpose: 'installation' | 'history'): RecoveryState {
  if (purpose !== 'installation' || value.operationId !== null || value.manifestDigest !== null || value.attestationDigest !== null) throw new RecoveryControlError('recovery_required');
  return Object.freeze({phase: 'ready', purpose, operationId: null, manifestDigest: null, attestationDigest: null});
}
