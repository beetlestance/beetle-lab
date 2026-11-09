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
function open(path: string, create: boolean, allowed: State['phase'][]): ControlStore {
  const store = ControlStore.open(path, create);
  try {
    if (!allowed.includes(store.snapshot().phase)) throw new InstallationStateError('recovery_required');
    return store;
  } catch (error) { store.close(); throw error; }
}
/** Opens a durable ready gate, exclusively held until the whole runtime drains. */
export function openServingState(path: string): ServingState {
  const store = open(path, false, ['ready']);
  const initial = store.snapshot();
  if (initial.phase !== 'ready') throw new InstallationStateError('recovery_required');
  return Object.freeze({ journalAuthority: initial.authority,
    assertJournalAuthority: (actual: string) => {
      authority(actual); const current = store.snapshot();
      if (current.phase !== 'ready' || current.authority !== actual) throw new InstallationStateError('recovery_required');
    }, close: () => store.close() });
}
function initialization(store: ControlStore): InitializingState {
  const initial = store.snapshot();
  if (initial.phase !== 'initializing') throw new InstallationStateError('recovery_required');
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
  const store = open(path, false, ['ready', 'restoring']);
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
