import { randomUUID } from 'node:crypto';
import { ControlStore } from './storage.js';
import { authority, InstallationStateError } from './types.js';
import type { State } from './types.js';
export { InstallationStateError } from './types.js';
export type { InstallationStateCode } from './types.js';

export interface ServingState {
  readonly journalAuthority: string;
  assertJournalAuthority(actual: string): void;
  close(): void;
}
export interface InitializingState {
  readonly operationId: string;
  complete(journalAuthority: string): void;
  close(): void;
}
export interface RestoringState {
  snapshot(): Readonly<Extract<State, { phase: 'ready' | 'restoring' }>>;
  begin(operationId: string): Readonly<Extract<State, { phase: 'restoring' }>>;
  complete(operationId: string, installedJournalAuthority: string): void;
  close(): void;
}
interface AcquiredState { readonly store: ControlStore; readonly state: Readonly<State> }
function open(path: string, create: boolean, allowed: State['phase'][]): AcquiredState {
  const store = ControlStore.open(path, create);
  try {
    const state = store.snapshot();
    if (!allowed.includes(state.phase)) throw new InstallationStateError('recovery_required');
    return { store, state };
  } catch (error) { store.close(); throw error; }
}
/** Opens a durable ready gate, exclusively held until the whole runtime drains. */
export function openServingState(path: string): ServingState {
  const { store, state: initial } = open(path, false, ['ready']);
  if (initial.phase !== 'ready') { store.close(); throw new InstallationStateError('recovery_required'); }
  return Object.freeze({ journalAuthority: initial.authority,
    assertJournalAuthority: (actual: string) => {
      authority(actual); const current = store.snapshot();
      if (current.phase !== 'ready' || current.authority !== actual) throw new InstallationStateError('recovery_required');
    }, close: () => store.close() });
}
function initialization({ store, state: initial }: AcquiredState): InitializingState {
  if (initial.phase !== 'initializing') { store.close(); throw new InstallationStateError('recovery_required'); }
  return Object.freeze({ operationId: initial.operationId,
    complete: (journalAuthority: string) => {
      authority(journalAuthority);
      store.transition('initializing', { phase: 'ready', operationId: null, authority: journalAuthority, pending: null });
    }, close: () => store.close() });
}
/** Explicit new-installation operation; never called as fallback by serving startup. */
export function initializeInstallationState(path: string): InitializingState {
  return initialization(open(path, true, ['initializing']));
}
/** Explicit interrupted-initialization recovery; never opens a ready/restoring gate. */
export function resumeInstallationInitialization(path: string): InitializingState {
  return initialization(open(path, false, ['initializing']));
}
/** Offline coordinator only: caller proves physical quiescence and owns restored data. */
export function openRestoringState(path: string): RestoringState {
  const { store } = open(path, false, ['ready', 'restoring']);
  const snapshot = () => {
    const value = store.snapshot();
    if (value.phase === 'initializing') throw new InstallationStateError('recovery_required');
    return value;
  };
  return Object.freeze({ snapshot,
    begin: (operationId: string) => {
      authority(operationId); const current = snapshot();
      if (current.phase !== 'ready') throw new InstallationStateError('recovery_required');
      const next = { phase: 'restoring' as const, operationId, authority: current.authority, pending: randomUUID() };
      store.transition('ready', next); return Object.freeze(next);
    }, complete: (operationId: string, installedJournalAuthority: string) => {
      authority(operationId); authority(installedJournalAuthority); const current = snapshot();
      if (current.phase !== 'restoring' || current.operationId !== operationId || current.pending !== installedJournalAuthority) {
        throw new InstallationStateError('recovery_required');
      }
      store.transition('restoring', { phase: 'ready', operationId: null, authority: current.pending, pending: null });
    }, close: () => store.close() });
}
