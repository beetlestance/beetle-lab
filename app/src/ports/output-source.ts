import type { ClientResult } from '@beetle/contracts';
import type { RunnerAttemptIdentity, RunnerGateway } from './runner.js';
import type { Owned, SourceEnvelope, SourceChunkRequest, SourceChunk } from '@beetle/contracts/output-source';

/** Extension of the installation-owned runner connection, never a second pool. */
export interface RunnerOutputClient {
  source(signal?: AbortSignal): Promise<ClientResult<Owned<SourceEnvelope>>>;
  /** Caller supplies the byte length from exactly one declared artifact in its
   * verified, matched envelope. This expectation is private, not a wire field.
   */
  sourceChunk(request: SourceChunkRequest, artifactBytes: number,
    signal?: AbortSignal): Promise<ClientResult<Owned<SourceChunk>>>;
}

/** Output facade shares the same installation connection and original-call owner. */
export interface RunnerOutputGateway extends RunnerGateway {
  output(identity: RunnerAttemptIdentity): RunnerOutputClient;
}
