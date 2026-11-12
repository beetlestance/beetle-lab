import type { AttemptSnapshot } from '@beetle/contracts';
export type {AttemptIdentity,AttemptObservationInput} from '../attempt-observation/index.js';
export interface AttemptObservation {
  snapshot: Readonly<AttemptSnapshot>;
  runState: 'dispatching' | 'active' | 'finalizing';
}
