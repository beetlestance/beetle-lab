import { BackendControl } from './storage.js';
import { digest, identifier, RecoveryControlError } from './types.js';
export { RecoveryControlError } from './types.js';
export type { RecoveryState } from './types.js';
export interface BackendServingLease {close(): void}
/** Explicit offline initialization only. Existing files are never repaired or adopted. */
export function initializeBackendRecovery(path: string, installationId: string): void {
  const store = BackendControl.open(path, installationId, true); store.close();
}
export function openBackendServing(path: string, installationId: string): BackendServingLease {
  const store = BackendControl.open(path, installationId);
  try {if (store.snapshot().phase !== 'ready') throw new RecoveryControlError('recovery_required');}
  catch (error) {store.close(); throw error;}
  return Object.freeze({close: () => store.close()});
}
/** Offline coordinator only. Closing never clears an incomplete restore. */
export function openBackendRecovery(path: string, installationId: string) {
  const store = BackendControl.open(path, installationId);
  return Object.freeze({snapshot: () => store.snapshot(),
    begin(operationId: string, manifestDigest: string) {
      identifier(operationId); digest(manifestDigest); const current = store.snapshot();
      if (current.phase !== 'ready') throw new RecoveryControlError('recovery_required');
      store.transition(current, {phase: 'restoring', purpose: current.purpose, operationId, manifestDigest, attestationDigest: null});
    },
    complete(operationId: string, manifestDigest: string) {
      identifier(operationId); digest(manifestDigest); const current = store.snapshot();
      if (current.purpose !== 'installation' || current.phase !== 'restoring' || current.operationId !== operationId || current.manifestDigest !== manifestDigest) throw new RecoveryControlError('recovery_required');
      store.transition(current, {phase: 'ready', purpose: current.purpose, operationId: null, manifestDigest: null, attestationDigest: null});
    },
    completeHistorical(operationId: string, manifestDigest: string, attestationDigest: string) {
      digest(attestationDigest);
      identifier(operationId); digest(manifestDigest); const current = store.snapshot();
      if (current.purpose !== 'history' || current.phase !== 'restoring' || current.operationId !== operationId || current.manifestDigest !== manifestDigest) throw new RecoveryControlError('recovery_required');
      store.transition(current, {phase: 'historical', purpose: current.purpose, operationId, manifestDigest, attestationDigest});
    }, close: () => store.close()});
}

/** Fresh isolated historical destination only; never briefly publishes serving readiness. */
export function initializeHistoricalRecovery(input: {path: string; historyId: string; operationId: string; manifestDigest: string}): void {
  identifier(input.operationId); digest(input.manifestDigest);
  BackendControl.open(input.path, input.historyId, true, {phase: 'restoring', purpose: 'history', operationId: input.operationId, manifestDigest: input.manifestDigest, attestationDigest: null}).close();
}
export function openBackendHistorical(input: {path: string; historyId: string; operationId: string; manifestDigest: string; attestationDigest: string}) {
  const store = BackendControl.open(input.path, input.historyId);
  try {
    const current = store.snapshot();
    if (current.phase !== 'historical' || current.operationId !== input.operationId || current.manifestDigest !== input.manifestDigest || current.attestationDigest !== input.attestationDigest) throw new RecoveryControlError('recovery_required');
    return Object.freeze({sessions: store.sessions(), close: () => store.close()});
  } catch (error) {store.close(); throw error;}
}

/** Passive sealed-archive inspection; never initializes or writes authentication state. */
export function inspectHistoricalRecovery(path: string, installationId: string) {
  const store = BackendControl.readOnly(path, installationId);
  try {
    const value = store.snapshot();
    if (value.phase !== 'historical') throw new RecoveryControlError('recovery_required'); return value;
  } finally {store.close();}
}
