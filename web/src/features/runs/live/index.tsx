import { RunSnapshot } from '../RunSnapshot.js';
import type { RunSnapshotProps } from '../RunSnapshot.js';

export type LiveRunViewProps = RunSnapshotProps & {
  /** Hands off to the result view (remounts and re-reads). Call only for a terminal run. */
  showResult: () => void;
};

/**
 * Live run view (Penpot "Live run" boards) for a nonterminal run. Owned by Wave 1
 * package D; it currently renders the pre-redesign run body unchanged, including
 * after the run becomes terminal while watched.
 */
export function LiveRunView({ run, scope, runId }: LiveRunViewProps) {
  return <RunSnapshot run={run} scope={scope} runId={runId} />;
}
