import type { AttemptSnapshot } from '@beetle/contracts';

export type AttemptIdentity = Pick<AttemptSnapshot,
  'attemptId' | 'organizationId' | 'workspaceId' | 'generation' | 'intentDigest'>;
export interface AttemptObservationInput {
  expected: AttemptIdentity;
  previous: Readonly<AttemptSnapshot> | null;
  incoming: unknown;
}
