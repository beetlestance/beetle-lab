import { RunSnapshot } from '../RunSnapshot.js';
import type { RunSnapshotProps } from '../RunSnapshot.js';

/**
 * Run result view (Penpot "Run result" boards) for a terminal run. Owned by Wave 1
 * package E; it currently renders the pre-redesign run body unchanged.
 */
export function RunResultView(props: RunSnapshotProps) {
  return <RunSnapshot {...props} />;
}
