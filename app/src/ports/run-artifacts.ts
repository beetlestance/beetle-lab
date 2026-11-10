import type { RunArtifactPage } from '@beetle/contracts/api';
import type { RunKey } from './runs.js';
import type { OutputFileRecord } from './output-bytes.js';
export interface RunArtifactListQuery extends RunKey { readonly attemptId: string; readonly limit: number; readonly cursor?: string }
export interface RunArtifactKey extends RunKey { readonly attemptId: string; readonly artifactId: string }
/** Scoped immutable publication reads; neither a writer claim nor native IO. */
export interface RunArtifactsReader {
  listRunArtifacts(query: RunArtifactListQuery): Promise<RunArtifactPage>;
  getRunArtifact(key: RunArtifactKey): Promise<OutputFileRecord>;
}
