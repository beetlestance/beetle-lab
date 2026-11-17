import type { Quiescence, StagedK6Receipt } from './types.js';
export type State = { -readonly [K in keyof StagedK6Receipt]: StagedK6Receipt[K] };
export type Quiet = Record<keyof StagedK6Receipt['quiescence'], Quiescence>;
export function blank(): State {
  return {
    ok: false,
    reason: null,
    scope: null,
    inputFailure: null,
    execution: null,
    result: null,
    publication: null,
    notifications: 'complete',
    liveMetrics: { status: 'disabled', reason: null, producedBytes: 0, quiescence: 'confirmed' },
    quiescence: {
      input: 'not_started',
      execution: 'not_started',
      artifacts: 'not_started',
      journal: 'not_started',
      publication: 'not_started',
      notifications: 'not_started',
    },
  };
}
