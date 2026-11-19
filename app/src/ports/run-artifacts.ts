import type { RunArtifactPage } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';
import type { OutputFileRecord } from './output-bytes.js';
export interface RunArtifactListQuery extends RunKey {
  readonly attemptId: string;
  readonly limit: number;
  readonly cursor?: string;
}
export interface RunAttemptReadKey extends RunKey {
  readonly attemptId: string;
}
export interface RunArtifactKey extends RunAttemptReadKey {
  readonly artifactId: string;
}
export interface PublishedArtifactRead {
  readonly record: OutputFileRecord;
  readonly kind: string;
}
/** Scoped immutable publication reads; neither a writer claim nor native IO. */
export interface RunArtifactsReader {
  listRunArtifacts(query: RunArtifactListQuery): Promise<RunArtifactPage>;
  getRunArtifact(key: RunArtifactKey): Promise<PublishedArtifactRead>;
}
