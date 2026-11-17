import type { Reservation } from '../admission/index.js';
import type { LaunchState } from '../supervisor/index.js';
import { ControllerError } from './types.js';
export function reservation(input: unknown): Reservation {
  if (!input || typeof input !== 'object' || !('status' in input)) throw new ControllerError('journal');
  return input as Reservation;
}
export function unstartedCancelled(state: LaunchState, cancelRequested: boolean): boolean {
  return state.launch === 'unclaimed' && (cancelRequested || state.cancellation !== 'none');
}
export function runtimeStopped(state: LaunchState): boolean {
  const view = state.observation;
  return (
    state.launch !== 'unknown' &&
    state.launch !== 'unclaimed' &&
    view !== null &&
    (view.state === 'exited' || view.state === 'created')
  );
}
