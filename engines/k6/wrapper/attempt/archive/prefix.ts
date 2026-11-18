import type { JournalScope } from '../../control/index.js';

interface PrefixFile {
  readonly artifactId: string;
  readonly relativePath: string;
  readonly bytes: number;
  readonly sha256: string;
}
/** Both hashes cover complete headers and records, excluding any later append. */
export interface ArchivePrefix {
  readonly scope: Readonly<JournalScope>;
  readonly windows: number;
  readonly endTimeMs: number;
  readonly data: Readonly<PrefixFile>;
  readonly index: Readonly<PrefixFile>;
}
