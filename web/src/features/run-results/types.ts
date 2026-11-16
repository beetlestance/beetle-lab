import type { EngineResult } from '@beetle/contracts';
import type { Run } from '@beetle/contracts/api';

/** Validated bounded DTOs; this view neither fetches nor establishes publication. */
export interface RunResultProps {
  readonly scope: Run['scope'];
  readonly runId: string;
  readonly run: Readonly<Run> | null;
  readonly result: Readonly<EngineResult> | null;
  readonly status: 'loading' | 'unavailable' | 'error' | 'ready';
}
